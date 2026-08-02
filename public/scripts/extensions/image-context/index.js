import { appendMediaToMessage, chat_metadata, eventSource, event_types, main_api, saveChatConditional } from '../../../script.js';
import { getContext } from '../../extensions.js';
import { chat_completion_sources, getChatCompletionModel, oai_settings } from '../../openai.js';
import { textgen_types, textgenerationwebui_settings } from '../../textgen-settings.js';
import { createThumbnail, getBase64Async, getImageSizeFromDataURL, isDataURL } from '../../utils.js';
import { MEDIA_TYPE, SCROLL_BEHAVIOR } from '../../constants.js';

const MODULE_NAME = 'image-context';
const CHAT_COMPLETION_MEDIA_TYPES = new Set([MEDIA_TYPE.IMAGE, MEDIA_TYPE.VIDEO]);
const TEXT_COMPLETION_MEDIA_TYPES = new Set([MEDIA_TYPE.IMAGE]);
const MAX_KOBOLDCPP_IMAGES = 16;
const MAX_KOBOLDCPP_IMAGE_SIDE = 800;
const MAX_KOBOLDCPP_IMAGE_BYTES = 2 * 1024 * 1024;
const KOBOLDCPP_IMAGE_QUALITY = 0.82;
const CONTEXT_SELECTION_VERSION = 3;

function isChatCompletionKoboldCppActive() {
    return main_api === 'openai'
        && oai_settings.chat_completion_source === chat_completion_sources.CUSTOM
        && /^koboldcpp\/.+/.test(getChatCompletionModel() || '');
}

function isTextCompletionKoboldCppActive() {
    return main_api === 'textgenerationwebui'
        && textgenerationwebui_settings.type === textgen_types.KOBOLDCPP;
}

function getSupportedMediaTypes() {
    if (isChatCompletionKoboldCppActive()) {
        return CHAT_COMPLETION_MEDIA_TYPES;
    }

    if (isTextCompletionKoboldCppActive()) {
        return TEXT_COMPLETION_MEDIA_TYPES;
    }

    return new Set();
}

function isKoboldCppMultimodalActive() {
    return isChatCompletionKoboldCppActive() || isTextCompletionKoboldCppActive();
}

function syncBodyClass() {
    document.body.classList.toggle('image_context_supported', isKoboldCppMultimodalActive());
}

function shouldManageAttachment(mediaAttachment) {
    const mediaType = mediaAttachment?.type || MEDIA_TYPE.IMAGE;
    return Boolean(mediaAttachment?.url) && getSupportedMediaTypes().has(mediaType);
}

function ensureAttachmentContextState(mediaAttachment) {
    if (!shouldManageAttachment(mediaAttachment) || mediaAttachment.include_in_context !== undefined) {
        return false;
    }

    mediaAttachment.include_in_context = true;
    return true;
}

async function initializeMessageMedia(message) {
    if (!isKoboldCppMultimodalActive() || !Array.isArray(message?.extra?.media)) {
        return false;
    }

    let changed = false;

    for (const mediaAttachment of message.extra.media) {
        changed = ensureAttachmentContextState(mediaAttachment) || changed;
    }

    return changed;
}

function getManageableAttachments() {
    return getContext().chat
        .flatMap(message => Array.isArray(message?.extra?.media) ? message.extra.media : [])
        .filter(shouldManageAttachment);
}

function selectOnlyNewestAttachment() {
    const attachments = getManageableAttachments();
    const newestAttachment = attachments.at(-1);
    let changed = false;

    for (const mediaAttachment of attachments) {
        const includeInContext = mediaAttachment === newestAttachment;
        if (mediaAttachment.include_in_context !== includeInContext) {
            mediaAttachment.include_in_context = includeInContext;
            changed = true;
        }
    }

    return changed;
}

function renderChatMedia() {
    const context = getContext();

    $('.mes').each(function () {
        const messageId = Number($(this).attr('mesid'));
        if (isNaN(messageId)) {
            return;
        }

        const message = context.chat[messageId];
        if (!Array.isArray(message?.extra?.media) || message.extra.media.length === 0) {
            return;
        }

        appendMediaToMessage(message, $(this), SCROLL_BEHAVIOR.KEEP);
    });
}

async function initializeChatMedia({ save = false, rerender = false } = {}) {
    syncBodyClass();

    if (!isKoboldCppMultimodalActive()) {
        return;
    }

    const context = getContext();
    let changed = false;

    for (const message of context.chat) {
        changed = await initializeMessageMedia(message) || changed;
    }

    if (getManageableAttachments().length > 0
        && chat_metadata.imageContextSelectionVersion !== CONTEXT_SELECTION_VERSION) {
        changed = selectOnlyNewestAttachment() || changed;
        chat_metadata.imageContextSelectionVersion = CONTEXT_SELECTION_VERSION;
        changed = true;
    }

    if (rerender) {
        renderChatMedia();
    }

    if (changed && save) {
        await saveChatConditional();
    }
}

async function handleMessageMedia(messageId) {
    syncBodyClass();

    if (!isKoboldCppMultimodalActive()) {
        return;
    }

    const message = getContext().chat[messageId];
    const changed = await initializeMessageMedia(message);
    const hasManagedMedia = Array.isArray(message?.extra?.media)
        && message.extra.media.some(shouldManageAttachment);

    if (!changed && !hasManagedMedia) {
        return;
    }

    selectOnlyNewestAttachment();
    chat_metadata.imageContextSelectionVersion = CONTEXT_SELECTION_VERSION;
    renderChatMedia();
    await saveChatConditional();
}

function getMessageMediaForContext(message) {
    if (!Array.isArray(message?.extra?.media) || message.extra.media.length === 0) {
        return [];
    }

    return message.extra.media;
}

function getIncludedTextCompletionAttachments() {
    return getContext().chat
        .flatMap(message => getMessageMediaForContext(message))
        .filter(mediaAttachment => mediaAttachment?.include_in_context === true && shouldManageAttachment(mediaAttachment))
        .slice(-MAX_KOBOLDCPP_IMAGES);
}

function extractBase64FromDataUrl(url) {
    return isDataURL(url) ? url.split(',', 2)[1] || null : null;
}

async function normalizeKoboldCppImage(dataUrl) {
    const mimeType = dataUrl?.split(';')?.[0]?.split(':')?.[1];
    const dataSize = dataUrl.length * 0.75;
    const safeMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const { width, height } = await getImageSizeFromDataURL(dataUrl);

    if (Math.max(width, height) <= MAX_KOBOLDCPP_IMAGE_SIDE
        && dataSize <= MAX_KOBOLDCPP_IMAGE_BYTES
        && safeMimeTypes.includes(mimeType)) {
        return dataUrl;
    }

    return createThumbnail(
        dataUrl,
        MAX_KOBOLDCPP_IMAGE_SIDE,
        MAX_KOBOLDCPP_IMAGE_SIDE,
        'image/jpeg',
        KOBOLDCPP_IMAGE_QUALITY,
    );
}

async function convertAttachmentToBase64(mediaAttachment) {
    if (!mediaAttachment?.url) {
        return null;
    }

    try {
        if (isDataURL(mediaAttachment.url)) {
            const normalizedDataUrl = await normalizeKoboldCppImage(mediaAttachment.url);
            return extractBase64FromDataUrl(normalizedDataUrl);
        }

        const response = await fetch(mediaAttachment.url, { method: 'GET', cache: 'force-cache' });
        if (!response.ok) {
            throw new Error('Failed to fetch image');
        }

        const blob = await response.blob();
        const dataUrl = await getBase64Async(blob);
        const normalizedDataUrl = await normalizeKoboldCppImage(dataUrl);
        return extractBase64FromDataUrl(normalizedDataUrl);
    } catch (error) {
        console.error('Image context attachment skipped', error);
        return null;
    }
}

async function applyTextCompletionMedia(params) {
    if (!isTextCompletionKoboldCppActive()) {
        return;
    }

    const attachments = getIncludedTextCompletionAttachments();
    if (attachments.length === 0) {
        delete params.images;
        return;
    }

    const images = (await Promise.all(attachments.map(convertAttachmentToBase64))).filter(Boolean);

    if (images.length > 0) {
        params.images = images;
    } else {
        delete params.images;
    }
}

export async function init() {
    syncBodyClass();

    eventSource.on(event_types.APP_READY, () => initializeChatMedia({ save: true, rerender: true }));
    eventSource.on(event_types.CHAT_CHANGED, () => initializeChatMedia({ save: true, rerender: true }));
    eventSource.on(event_types.ONLINE_STATUS_CHANGED, () => initializeChatMedia({ save: true, rerender: true }));
    eventSource.on(event_types.MAIN_API_CHANGED, () => initializeChatMedia({ save: true, rerender: true }));
    eventSource.on(event_types.MESSAGE_SENT, handleMessageMedia);
    eventSource.on(event_types.MESSAGE_FILE_EMBEDDED, handleMessageMedia);
    eventSource.on(event_types.TEXT_COMPLETION_SETTINGS_READY, applyTextCompletionMedia);

    $(document).on('click', '.mes_media_include_in_context', async function () {
        if (!isKoboldCppMultimodalActive()) {
            return;
        }

        const messageBlock = $(this).closest('.mes');
        const mediaContainer = $(this).closest('.mes_media_container');
        const messageId = Number(messageBlock.attr('mesid'));
        const mediaIndex = Number(mediaContainer.attr('data-index'));
        const message = getContext().chat[messageId];
        const mediaAttachment = message?.extra?.media?.[mediaIndex];

        if (!shouldManageAttachment(mediaAttachment)) {
            return;
        }

        mediaAttachment.include_in_context = !mediaAttachment.include_in_context;
        appendMediaToMessage(message, messageBlock, SCROLL_BEHAVIOR.KEEP);
        await saveChatConditional();
    });
}

export { MODULE_NAME };
