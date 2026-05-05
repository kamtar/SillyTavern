import { appendMediaToMessage, eventSource, event_types, main_api, saveChatConditional } from '../../../script.js';
import { getContext } from '../../extensions.js';
import { chat_completion_sources, getChatCompletionModel, oai_settings } from '../../openai.js';
import { MEDIA_TYPE, SCROLL_BEHAVIOR } from '../../constants.js';

const MODULE_NAME = 'image-context';
const SUPPORTED_MEDIA_TYPES = new Set([MEDIA_TYPE.IMAGE, MEDIA_TYPE.VIDEO]);

function isKoboldCppMultimodalActive() {
    return main_api === 'openai'
        && oai_settings.chat_completion_source === chat_completion_sources.CUSTOM
        && /^koboldcpp\/.+/.test(getChatCompletionModel() || '');
}

function syncBodyClass() {
    document.body.classList.toggle('image_context_supported', isKoboldCppMultimodalActive());
}

function shouldManageAttachment(mediaAttachment) {
    const mediaType = mediaAttachment?.type || MEDIA_TYPE.IMAGE;
    return Boolean(mediaAttachment?.url) && SUPPORTED_MEDIA_TYPES.has(mediaType);
}

function ensureAttachmentContextState(mediaAttachment) {
    if (!shouldManageAttachment(mediaAttachment) || mediaAttachment.include_in_context !== undefined) {
        return false;
    }

    mediaAttachment.include_in_context = false;
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

    if (rerender) {
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

    if (!await initializeMessageMedia(message)) {
        return;
    }

    await saveChatConditional();
}

export async function init() {
    syncBodyClass();

    eventSource.on(event_types.APP_READY, () => initializeChatMedia({ save: true, rerender: true }));
    eventSource.on(event_types.CHAT_CHANGED, () => initializeChatMedia({ save: true, rerender: true }));
    eventSource.on(event_types.ONLINE_STATUS_CHANGED, () => initializeChatMedia({ save: true, rerender: true }));
    eventSource.on(event_types.MESSAGE_SENT, handleMessageMedia);
    eventSource.on(event_types.MESSAGE_FILE_EMBEDDED, handleMessageMedia);

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
