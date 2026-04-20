(function () {
    const statusElement = document.querySelector("[data-blog-status]");
    const postsElement = document.querySelector("[data-post-list]");
    const loginPanel = document.querySelector("[data-login-panel]");
    const editorPanel = document.querySelector("[data-editor-panel]");
    const loginForm = document.querySelector("[data-login-form]");
    const postForm = document.querySelector("[data-post-form]");
    const userState = document.querySelector("[data-user-state]");
    const logoutButton = document.querySelector("[data-logout]");
    const attachmentStatus = document.querySelector("[data-attachment-status]");
    const contentEditor = document.querySelector("[data-content-editor]");
    const imageSizeToolbar = document.querySelector("[data-image-size-toolbar]");
    const submitPostButton = document.querySelector("[data-submit-post]");
    const cancelEditButton = document.querySelector("[data-cancel-edit]");
    let currentUser = null;
    let cachedPosts = [];
    let idleTimer = null;
    let currentEditingPostId = null;
    let selectedEditorImage = null;
    let pendingAttachmentFiles = [];
    let pendingInlineImageFiles = [];
    let previewObjectUrls = [];
    const idleLimitMs = 15 * 60 * 1000;

    const demoPosts = [];

    function setStatus(message, isError) {
        if (!statusElement) {
            return;
        }

        statusElement.textContent = message;
        statusElement.style.borderColor = isError ? "rgba(255, 99, 132, 0.55)" : "rgba(255, 255, 255, 0.18)";
        statusElement.style.color = isError ? "#ffd3dc" : "rgba(255, 255, 255, 0.92)";
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatDate(value) {
        if (!value) {
            return "Draft";
        }

        if (value instanceof Date) {
            return value.toLocaleDateString();
        }

        if (typeof value.toDate === "function") {
            return value.toDate().toLocaleDateString();
        }

        if (value.seconds) {
            return new Date(value.seconds * 1000).toLocaleDateString();
        }

        return new Date(value).toLocaleDateString();
    }

    function formatBytes(value) {
        const bytes = Number(value || 0);
        if (!bytes) {
            return "";
        }

        const units = ["B", "KB", "MB", "GB"];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex += 1;
        }

        return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    }

    function getEmbeddedAttachmentNames(content, attachments) {
        const names = new Set();
        const text = String(content || "");
        const normalizedText = text.toLowerCase();

        text.replace(/(?:!\[[^\]]*\]|\[[^\]]+\])\(attachment:([^\)]+)\)/gi, (match, name) => {
            names.add(String(name || "").trim().toLowerCase());
            return match;
        });

        (Array.isArray(attachments) ? attachments : []).forEach((attachment) => {
            const name = String(attachment && attachment.name || "").trim().toLowerCase();
            const url = String(attachment && attachment.url || "").trim().toLowerCase();

            if (!name) {
                return;
            }

            if (normalizedText.includes(`attachment:${name}`) || normalizedText.includes(`data-attachment-name="${name}"`) || (url && normalizedText.includes(url))) {
                names.add(name);
            }
        });

        return names;
    }

    function ensureFileAttachmentId(file) {
        if (!file) {
            return "";
        }

        if (!file.__attachmentId) {
            file.__attachmentId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        }

        return file.__attachmentId;
    }

    function buildAttachmentLookup(attachments) {
        const lookup = new Map();

        (Array.isArray(attachments) ? attachments : []).forEach((attachment) => {
            if (!attachment || !attachment.url) {
                return;
            }

            const id = String(attachment.id || "").trim().toLowerCase();
            const name = String(attachment.name || "").trim().toLowerCase();

            if (id) {
                lookup.set(`id:${id}`, attachment);
            }

            if (name && !lookup.has(`name:${name}`)) {
                lookup.set(`name:${name}`, attachment);
            }
        });

        return lookup;
    }

    function getAttachmentByReference(attachmentLookup, reference, fallbackName) {
        const ref = String(reference || "").trim().toLowerCase();
        const fallback = String(fallbackName || "").trim().toLowerCase();

        return (ref && (attachmentLookup.get(`id:${ref}`) || attachmentLookup.get(`name:${ref}`)))
            || (fallback && attachmentLookup.get(`name:${fallback}`))
            || null;
    }

    function renderAttachments(attachments, content) {
        const embeddedNames = getEmbeddedAttachmentNames(content, attachments);
        const safeAttachments = Array.isArray(attachments)
            ? attachments.filter((attachment) => attachment && attachment.url && !embeddedNames.has(String(attachment.name || "").trim().toLowerCase()))
            : [];

        if (!safeAttachments.length) {
            return "";
        }

        const items = safeAttachments.map((attachment) => {
            const name = escapeHtml(attachment.name || "Attachment");
            const url = escapeHtml(attachment.url);
            const type = String(attachment.type || "").toLowerCase();
            const typeLabel = escapeHtml(attachment.type || "File");
            const sizeLabel = attachment.size ? ` • ${escapeHtml(formatBytes(attachment.size))}` : "";

            if (type.startsWith("image/")) {
                return `
                    <div class="attachment-item">
                        <a href="${url}" target="_blank" rel="noopener noreferrer">
                            <img class="post-image" src="${url}" alt="${name}">
                        </a>
                        <div class="meta">${name}${sizeLabel}</div>
                    </div>
                `;
            }

            return `
                <div class="attachment-item">
                    <a class="btn btn-secondary" href="${url}" target="_blank" rel="noopener noreferrer">Open ${name}</a>
                    <div class="meta">${typeLabel}${sizeLabel}</div>
                </div>
            `;
        }).join("");

        return `
            <div class="post-attachments">
                <h3>Attachments</h3>
                <div class="attachment-list">${items}</div>
            </div>
        `;
    }

    function replaceAttachmentPlaceholdersInContainer(container, attachmentLookup) {
        const textNodes = [];
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

        while (walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }

        textNodes.forEach((node) => {
            const text = node.textContent || "";
            const pattern = /!\[([^\]]*)\]\(attachment:([^\)]+)\)|\[([^\]]+)\]\(attachment:([^\)]+)\)/gi;

            if (!pattern.test(text)) {
                return;
            }

            pattern.lastIndex = 0;
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;

            while ((match = pattern.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                }

                const isImage = !!match[2];
                const label = String(match[1] || match[3] || "");
                const rawName = String(match[2] || match[4] || "").trim().toLowerCase();
                const attachment = getAttachmentByReference(attachmentLookup, rawName, rawName);

                if (attachment) {
                    if (isImage && String(attachment.type || "").toLowerCase().startsWith("image/")) {
                        const image = document.createElement("img");
                        image.className = "post-image";
                        image.src = attachment.url;
                        image.alt = label || attachment.name || "Image";
                        image.setAttribute("data-attachment-name", attachment.name || rawName);
                        if (attachment.id) {
                            image.setAttribute("data-attachment-id", attachment.id);
                        }
                        image.setAttribute("data-image-size", "large");
                        fragment.appendChild(image);
                    } else {
                        const link = document.createElement("a");
                        link.href = attachment.url;
                        link.target = "_blank";
                        link.rel = "noopener noreferrer";
                        link.textContent = label || attachment.name || "Attachment";
                        link.setAttribute("data-attachment-name", attachment.name || rawName);
                        if (attachment.id) {
                            link.setAttribute("data-attachment-id", attachment.id);
                        }
                        fragment.appendChild(link);
                    }
                } else {
                    fragment.appendChild(document.createTextNode(match[0]));
                }

                lastIndex = pattern.lastIndex;
            }

            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
            }

            if (node.parentNode) {
                node.parentNode.replaceChild(fragment, node);
            }
        });
    }

    function sanitizeRichContent(content, attachments) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = String(content || "");

        wrapper.querySelectorAll("script, style, iframe, object, embed").forEach((element) => element.remove());

        const attachmentLookup = buildAttachmentLookup(attachments);

        wrapper.querySelectorAll("*").forEach((element) => {
            Array.from(element.attributes).forEach((attribute) => {
                const attributeName = attribute.name.toLowerCase();
                if (attributeName.startsWith("on") || attributeName === "style" || attributeName === "contenteditable" || attributeName === "spellcheck") {
                    element.removeAttribute(attribute.name);
                }
            });

            if (element.tagName === "IMG") {
                const attachmentId = String(element.getAttribute("data-attachment-id") || "").trim().toLowerCase();
                const attachmentName = String(element.getAttribute("data-attachment-name") || "").trim().toLowerCase();
                const fallbackName = String(element.getAttribute("alt") || "").trim().toLowerCase();
                const resolvedAttachment = getAttachmentByReference(attachmentLookup, attachmentId || attachmentName, fallbackName);

                if (resolvedAttachment) {
                    element.setAttribute("src", resolvedAttachment.url);
                    if (resolvedAttachment.id) {
                        element.setAttribute("data-attachment-id", resolvedAttachment.id);
                    }
                }

                element.classList.add("post-image");
                element.removeAttribute("data-attachment-name");
            }

            if (element.tagName === "A") {
                const attachmentId = String(element.getAttribute("data-attachment-id") || "").trim().toLowerCase();
                const attachmentName = String(element.getAttribute("data-attachment-name") || "").trim().toLowerCase();
                const fallbackName = String(element.textContent || "").trim().toLowerCase();
                const resolvedAttachment = getAttachmentByReference(attachmentLookup, attachmentId || attachmentName, fallbackName);

                if (resolvedAttachment) {
                    element.setAttribute("href", resolvedAttachment.url);
                    if (resolvedAttachment.id) {
                        element.setAttribute("data-attachment-id", resolvedAttachment.id);
                    }
                }
                element.setAttribute("target", "_blank");
                element.setAttribute("rel", "noopener noreferrer");
                element.removeAttribute("data-attachment-name");
            }
        });

        replaceAttachmentPlaceholdersInContainer(wrapper, attachmentLookup);
        return wrapper.innerHTML;
    }

    function renderContent(content, attachments) {
        const text = String(content || "").replace(/\r\n/g, "\n");
        if (!text.trim()) {
            return "";
        }

        if (/<[a-z][\s\S]*>/i.test(text)) {
            return sanitizeRichContent(text, attachments);
        }

        const attachmentLookup = buildAttachmentLookup(attachments);

        let html = escapeHtml(text);

        html = html.replace(/!\[([^\]]*)\]\(attachment:([^\)]+)\)/gi, (match, altText, name) => {
            const rawName = String(name || "").trim().toLowerCase();
            const attachment = getAttachmentByReference(attachmentLookup, rawName, rawName);
            if (!attachment || !String(attachment.type || "").toLowerCase().startsWith("image/")) {
                return escapeHtml(match);
            }

            return `<img class="post-image" src="${escapeHtml(attachment.url)}" alt="${escapeHtml(altText || attachment.name || "Image")}"${attachment.id ? ` data-attachment-id="${escapeHtml(attachment.id)}"` : ""}>`;
        });

        html = html.replace(/\[([^\]]+)\]\(attachment:([^\)]+)\)/gi, (match, label, name) => {
            const rawName = String(name || "").trim().toLowerCase();
            const attachment = getAttachmentByReference(attachmentLookup, rawName, rawName);
            if (!attachment) {
                return escapeHtml(match);
            }

            return `<a href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener noreferrer"${attachment.id ? ` data-attachment-id="${escapeHtml(attachment.id)}"` : ""}>${escapeHtml(label || attachment.name || "Attachment")}</a>`;
        });

        return html.replace(/\n/g, "<br>");
    }

    function getAttachmentInput() {
        return postForm ? postForm.querySelector("[name=attachments]") : null;
    }

    function isImageFile(file) {
        return !!file && String(file.type || "").toLowerCase().startsWith("image/");
    }

    function clearPreviewObjectUrls() {
        previewObjectUrls.forEach((url) => {
            try {
                URL.revokeObjectURL(url);
            } catch (error) {
                console.warn("Preview URL cleanup failed.", error);
            }
        });
        previewObjectUrls = [];
    }

    function syncContentInput() {
        if (!postForm || !contentEditor) {
            return;
        }

        const contentInput = postForm.querySelector("[name=content]");
        if (contentInput) {
            const clone = contentEditor.cloneNode(true);
            clone.querySelectorAll(".is-selected").forEach((element) => element.classList.remove("is-selected"));
            contentInput.value = clone.innerHTML.trim();
        }
    }

    function clearSelectedEditorImage() {
        if (selectedEditorImage) {
            selectedEditorImage.classList.remove("is-selected");
        }

        selectedEditorImage = null;
        if (imageSizeToolbar) {
            imageSizeToolbar.hidden = true;
        }
    }

    function selectEditorImage(image) {
        clearSelectedEditorImage();

        if (!image) {
            return;
        }

        selectedEditorImage = image;
        selectedEditorImage.classList.add("is-selected");

        if (imageSizeToolbar) {
            imageSizeToolbar.hidden = false;
        }
    }

    function applySelectedImageSize(size) {
        if (!selectedEditorImage) {
            return;
        }

        if (!size || size === "original") {
            selectedEditorImage.removeAttribute("data-image-size");
        } else {
            selectedEditorImage.setAttribute("data-image-size", size);
        }

        syncContentInput();
    }

    function getPendingEditorAttachments() {
        return pendingAttachmentFiles.map((file) => {
            const url = URL.createObjectURL(file);
            previewObjectUrls.push(url);
            return {
                id: ensureFileAttachmentId(file),
                name: file.name || "Attachment",
                url,
                type: file.type || "application/octet-stream",
                size: file.size || 0
            };
        });
    }

    function buildPersistedEditorContent(attachments) {
        const sourceHtml = contentEditor ? contentEditor.innerHTML : "";
        if (!String(sourceHtml || "").trim()) {
            return "";
        }

        const wrapper = document.createElement("div");
        wrapper.innerHTML = sourceHtml;
        const attachmentLookup = buildAttachmentLookup(attachments);

        wrapper.querySelectorAll("img").forEach((element) => {
            const attachmentId = String(element.getAttribute("data-attachment-id") || "").trim().toLowerCase();
            const attachmentName = String(element.getAttribute("data-attachment-name") || "").trim().toLowerCase();
            const fallbackName = String(element.getAttribute("alt") || "").trim().toLowerCase();
            const resolvedAttachment = getAttachmentByReference(attachmentLookup, attachmentId || attachmentName, fallbackName);
            const currentSrc = String(element.getAttribute("src") || "").trim();

            if (resolvedAttachment && resolvedAttachment.url) {
                element.setAttribute("src", resolvedAttachment.url);
                if (resolvedAttachment.id) {
                    element.setAttribute("data-attachment-id", resolvedAttachment.id);
                }
            } else if (currentSrc.startsWith("blob:")) {
                element.remove();
                return;
            }

            element.classList.add("post-image");
            element.removeAttribute("data-attachment-name");
        });

        wrapper.querySelectorAll("a").forEach((element) => {
            const attachmentId = String(element.getAttribute("data-attachment-id") || "").trim().toLowerCase();
            const attachmentName = String(element.getAttribute("data-attachment-name") || "").trim().toLowerCase();
            const fallbackName = String(element.textContent || "").trim().toLowerCase();
            const resolvedAttachment = getAttachmentByReference(attachmentLookup, attachmentId || attachmentName, fallbackName);

            if (resolvedAttachment && resolvedAttachment.url) {
                element.setAttribute("href", resolvedAttachment.url);
                if (resolvedAttachment.id) {
                    element.setAttribute("data-attachment-id", resolvedAttachment.id);
                }
            }

            element.setAttribute("target", "_blank");
            element.setAttribute("rel", "noopener noreferrer");
            element.removeAttribute("data-attachment-name");
        });

        return sanitizeRichContent(wrapper.innerHTML, attachments);
    }

    function normalizeEditorContent() {
        if (!contentEditor) {
            return;
        }

        if (pendingAttachmentFiles.length && contentEditor.innerHTML.toLowerCase().includes("attachment:")) {
            const attachmentLookup = buildAttachmentLookup(getPendingEditorAttachments());
            replaceAttachmentPlaceholdersInContainer(contentEditor, attachmentLookup);
        }

        syncContentInput();
    }

    function mergeInlineImageFiles(newFiles) {
        const incoming = Array.from(newFiles || []).filter((file) => file && isImageFile(file));
        if (!incoming.length) {
            return pendingInlineImageFiles;
        }

        const combined = [...pendingInlineImageFiles];
        const knownKeys = new Set(combined.map((file) => ensureFileAttachmentId(file)));

        incoming.forEach((file) => {
            const fileId = ensureFileAttachmentId(file);
            if (!knownKeys.has(fileId)) {
                knownKeys.add(fileId);
                combined.push(file);
            }
        });

        pendingInlineImageFiles = combined.slice(0, 10);
        return pendingInlineImageFiles;
    }

    function describeSelectedAttachments(files, existingCount) {
        if (!attachmentStatus) {
            return;
        }

        const selected = Array.from(files || []);

        if (!selected.length) {
            if (existingCount) {
                attachmentStatus.textContent = `${existingCount} existing attachment${existingCount === 1 ? "" : "s"} will stay attached unless you add more.`;
                return;
            }

            attachmentStatus.textContent = "No attachments selected.";
            return;
        }

        attachmentStatus.textContent = `${selected.length} attachment${selected.length === 1 ? "" : "s"} ready: ${selected.map((file) => file.name).join(", ")}`;
    }

    function resetEditorForm(options) {
        const config = options || {};

        currentEditingPostId = null;
        if (postForm) {
            postForm.reset();
        }
        if (contentEditor) {
            contentEditor.innerHTML = "";
        }

        clearPreviewObjectUrls();
        clearSelectedEditorImage();
        pendingAttachmentFiles = [];
        pendingInlineImageFiles = [];
        syncAttachmentInput([]);
        syncContentInput();
        describeSelectedAttachments([]);

        if (submitPostButton) {
            submitPostButton.textContent = "Publish Post";
        }
        if (cancelEditButton) {
            cancelEditButton.hidden = true;
        }

        if (!config.silent) {
            setStatus("Editor is ready for a new post.", false);
        }
    }

    function loadPostIntoEditor(post) {
        if (!postForm || !post) {
            return;
        }

        currentEditingPostId = post.id || null;
        postForm.querySelector("[name=title]").value = post.title || "";
        postForm.querySelector("[name=category]").value = post.category || "";
        postForm.querySelector("[name=summary]").value = post.summary || "";

        if (contentEditor) {
            contentEditor.innerHTML = String(post.content || "");
        }

        clearPreviewObjectUrls();
        pendingAttachmentFiles = [];
        pendingInlineImageFiles = [];
        syncAttachmentInput([]);
        syncContentInput();
        describeSelectedAttachments([], Array.isArray(post.attachments) ? post.attachments.length : 0);

        if (submitPostButton) {
            submitPostButton.textContent = "Update Post";
        }
        if (cancelEditButton) {
            cancelEditButton.hidden = false;
        }
        if (editorPanel) {
            editorPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        }

        setStatus(`Editing post: ${post.title || "Untitled Post"}`, false);
    }

    function syncAttachmentInput(files) {
        const attachmentInput = getAttachmentInput();
        if (!attachmentInput || typeof DataTransfer !== "function") {
            return;
        }

        const transfer = new DataTransfer();
        Array.from(files || []).forEach((file) => transfer.items.add(file));
        attachmentInput.files = transfer.files;
    }

    function insertHtmlAtCursor(field, html) {
        if (!field) {
            return;
        }

        field.focus();
        const selection = window.getSelection();

        if (!selection || !selection.rangeCount) {
            field.insertAdjacentHTML("beforeend", html);
            syncContentInput();
            return;
        }

        const range = selection.getRangeAt(0);
        if (!field.contains(range.commonAncestorContainer)) {
            field.insertAdjacentHTML("beforeend", html);
            syncContentInput();
            return;
        }

        range.deleteContents();
        const fragment = range.createContextualFragment(html);
        const lastNode = fragment.lastChild;
        range.insertNode(fragment);

        if (lastNode) {
            range.setStartAfter(lastNode);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        syncContentInput();
    }

    function convertTextWithAttachmentsToHtml(text, attachmentLookup) {
        const source = String(text || "");
        const pattern = /!\[([^\]]*)\]\(attachment:([^\)]+)\)|\[([^\]]+)\]\(attachment:([^\)]+)\)/gi;
        let lastIndex = 0;
        let html = "";
        let match;

        while ((match = pattern.exec(source)) !== null) {
            if (match.index > lastIndex) {
                html += escapeHtml(source.slice(lastIndex, match.index)).replace(/\n/g, "<br>");
            }

            const isImage = !!match[2];
            const label = String(match[1] || match[3] || "");
            const rawName = String(match[2] || match[4] || "").trim().toLowerCase();
            const attachment = getAttachmentByReference(attachmentLookup, rawName, rawName);

            if (attachment) {
                if (isImage && String(attachment.type || "").toLowerCase().startsWith("image/")) {
                    html += `<img class="post-image" src="${escapeHtml(attachment.url)}" alt="${escapeHtml(label || attachment.name || "Image")}" data-attachment-name="${escapeHtml(attachment.name || rawName)}" data-image-size="large">`;
                } else {
                    html += `<a href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener noreferrer" data-attachment-name="${escapeHtml(attachment.name || rawName)}">${escapeHtml(label || attachment.name || "Attachment")}</a>`;
                }
            } else {
                html += escapeHtml(match[0]);
            }

            lastIndex = pattern.lastIndex;
        }

        if (lastIndex < source.length) {
            html += escapeHtml(source.slice(lastIndex)).replace(/\n/g, "<br>");
        }

        return html;
    }

    async function insertAttachmentsIntoEditor(files) {
        if (!contentEditor) {
            return;
        }

        const htmlParts = [];

        for (const file of Array.from(files || [])) {
            const safeName = escapeHtml(file.name || "Attachment");
            const attributeName = escapeHtml(file.name || "Attachment");
            const attachmentId = ensureFileAttachmentId(file);

            if (String(file.type || "").toLowerCase().startsWith("image/")) {
                try {
                    const inlineDataUrl = await fileToOptimizedDataUrl(file);
                    htmlParts.push(`<p><img class="post-image" src="${escapeHtml(inlineDataUrl)}" alt="${safeName}" data-image-size="large"></p>`);
                } catch (error) {
                    console.error(error);
                    htmlParts.push(`<p>${safeName}</p>`);
                }
                continue;
            }

            htmlParts.push(`<p><a href="#" data-attachment-name="${attributeName}" data-attachment-id="${escapeHtml(attachmentId)}">${safeName}</a></p>`);
        }

        insertHtmlAtCursor(contentEditor, htmlParts.join(""));

        const images = contentEditor.querySelectorAll("img.post-image");
        selectEditorImage(images[images.length - 1] || null);
    }

    function mergeAttachmentFiles(newFiles) {
        const incoming = Array.from(newFiles || []).filter((file) => file && !isImageFile(file));

        if (!incoming.length) {
            syncAttachmentInput(pendingAttachmentFiles);
            describeSelectedAttachments(pendingAttachmentFiles);
            return pendingAttachmentFiles;
        }

        const combined = [...pendingAttachmentFiles];
        const knownKeys = new Set(combined.map((file) => ensureFileAttachmentId(file) || `${file.name}-${file.size}-${file.lastModified}-${file.type}`));

        incoming.forEach((file) => {
            const fileId = ensureFileAttachmentId(file);
            const key = fileId || `${file.name}-${file.size}-${file.lastModified}-${file.type}`;
            if (!knownKeys.has(key)) {
                knownKeys.add(key);
                combined.push(file);
            }
        });

        pendingAttachmentFiles = combined.slice(0, 5);
        syncAttachmentInput(pendingAttachmentFiles);
        describeSelectedAttachments(pendingAttachmentFiles);
        return pendingAttachmentFiles;
    }

    function bindClipboardPaste() {
        if (!postForm) {
            return;
        }

        const attachmentInput = getAttachmentInput();

        if (contentEditor) {
            contentEditor.addEventListener("input", () => {
                normalizeEditorContent();
            });
        }

        if (attachmentInput) {
            attachmentInput.addEventListener("change", async () => {
                const nextFiles = Array.from(attachmentInput.files || []).slice(0, 5);
                const imageFiles = nextFiles.filter((file) => isImageFile(file));
                const otherFiles = nextFiles.filter((file) => !isImageFile(file));
                const existingKeys = new Set(pendingAttachmentFiles.map((file) => ensureFileAttachmentId(file) || `${file.name}-${file.size}-${file.lastModified}-${file.type}`));
                const newOnlyFiles = nextFiles.filter((file) => !existingKeys.has(ensureFileAttachmentId(file) || `${file.name}-${file.size}-${file.lastModified}-${file.type}`));
                const newOnlyImages = newOnlyFiles.filter((file) => isImageFile(file));

                mergeAttachmentFiles(otherFiles);

                if (newOnlyImages.length) {
                    await insertAttachmentsIntoEditor(newOnlyImages);
                }

                if (!imageFiles.length) {
                    syncAttachmentInput(pendingAttachmentFiles);
                }

                normalizeEditorContent();
            });

            pendingAttachmentFiles = Array.from(attachmentInput.files || []).filter((file) => !isImageFile(file));
            describeSelectedAttachments(pendingAttachmentFiles);
        }

        if (!contentEditor) {
            return;
        }

        contentEditor.addEventListener("click", (event) => {
            const image = event.target.closest("img.post-image");
            if (image && contentEditor.contains(image)) {
                selectEditorImage(image);
                return;
            }

            clearSelectedEditorImage();
        });

        if (imageSizeToolbar) {
            imageSizeToolbar.addEventListener("click", (event) => {
                const button = event.target.closest("[data-image-size]");
                if (!button) {
                    return;
                }

                applySelectedImageSize(button.getAttribute("data-image-size"));
            });
        }

        contentEditor.addEventListener("paste", async (event) => {
            const items = Array.from(event.clipboardData?.items || []);
            const pastedFiles = items
                .filter((item) => item.kind === "file")
                .map((item) => item.getAsFile())
                .filter(Boolean);

            if (pastedFiles.length) {
                event.preventDefault();
                const imageFiles = pastedFiles.filter((file) => isImageFile(file));
                const otherFiles = pastedFiles.filter((file) => !isImageFile(file));
                const finalFiles = mergeAttachmentFiles(otherFiles);

                if (imageFiles.length) {
                    await insertAttachmentsIntoEditor(imageFiles);
                }

                normalizeEditorContent();
                setStatus(`${pastedFiles.length} clipboard attachment${pastedFiles.length === 1 ? "" : "s"} added inline.`, false);

                if (finalFiles.length >= 5) {
                    setStatus("Up to 5 attachments are allowed per post.", true);
                }
                return;
            }

            const pastedText = event.clipboardData?.getData("text/plain") || "";
            if (pastedText.includes("attachment:")) {
                event.preventDefault();
                clearPreviewObjectUrls();
                const attachmentLookup = buildAttachmentLookup(getPendingEditorAttachments());
                const html = convertTextWithAttachmentsToHtml(pastedText, attachmentLookup);
                insertHtmlAtCursor(contentEditor, html);
                normalizeEditorContent();
                setStatus("Attachment text converted to inline content.", false);
            }
        });

        normalizeEditorContent();
    }

    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error(`Could not read ${file.name || "attachment"}.`));
            reader.readAsDataURL(file);
        });
    }

    function fileToOptimizedDataUrl(file) {
        return new Promise((resolve, reject) => {
            fileToDataUrl(file).then((dataUrl) => {
                const image = new Image();
                image.onload = () => {
                    try {
                        const maxDimension = 1200;
                        let width = image.width || maxDimension;
                        let height = image.height || maxDimension;
                        const scale = Math.min(1, maxDimension / Math.max(width, height));

                        width = Math.max(1, Math.round(width * scale));
                        height = Math.max(1, Math.round(height * scale));

                        const canvas = document.createElement("canvas");
                        canvas.width = width;
                        canvas.height = height;
                        const context = canvas.getContext("2d");

                        if (!context) {
                            resolve(dataUrl);
                            return;
                        }

                        context.drawImage(image, 0, 0, width, height);
                        const outputType = "image/jpeg";
                        resolve(canvas.toDataURL(outputType, 0.72));
                    } catch (error) {
                        console.error(error);
                        resolve(dataUrl);
                    }
                };
                image.onerror = () => resolve(dataUrl);
                image.src = dataUrl;
            }).catch(reject);
        });
    }

    async function uploadAttachments(fileList) {
        const files = Array.from(fileList || []).filter(Boolean);

        if (!files.length) {
            return [];
        }

        if (files.length > 5) {
            throw new Error("Please upload up to 5 files per post.");
        }

        const uploads = [];
        const failedFiles = [];

        for (const file of files) {
            if (file.size > 10 * 1024 * 1024) {
                throw new Error(`${file.name} is larger than 10 MB.`);
            }

            const attachmentId = ensureFileAttachmentId(file);

            try {
                if (!storage) {
                    throw new Error("Firebase Storage is not enabled for attachments.");
                }

                const safeName = String(file.name || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
                const fileRef = storage.ref().child(`blog-attachments/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`);
                const snapshot = await fileRef.put(file, {
                    contentType: file.type || "application/octet-stream"
                });
                const url = await snapshot.ref.getDownloadURL();

                uploads.push({
                    id: attachmentId,
                    name: file.name || "Attachment",
                    url,
                    type: file.type || "application/octet-stream",
                    size: file.size || 0,
                    path: snapshot.ref.fullPath
                });
            } catch (error) {
                const isImage = String(file.type || "").toLowerCase().startsWith("image/");

                if (isImage) {
                    try {
                        const dataUrl = await fileToOptimizedDataUrl(file);
                        uploads.push({
                            id: attachmentId,
                            name: file.name || "Attachment",
                            url: dataUrl,
                            type: file.type || "application/octet-stream",
                            size: file.size || 0,
                            embedded: true
                        });
                    } catch (readError) {
                        console.error(readError);
                        failedFiles.push(file.name || "Attachment");
                    }
                } else {
                    console.error(error);
                    failedFiles.push(file.name || "Attachment");
                }
            }
        }

        if (failedFiles.length) {
            setStatus(`Some files could not be attached: ${failedFiles.join(", ")}. The post will still be published.`, true);
        }

        return uploads;
    }

    function renderPosts(posts) {
        if (!postsElement) {
            return;
        }

        if (!posts.length) {
            postsElement.innerHTML = "<article class=\"post-card\"><div class=\"meta\">No posts yet</div><h2>Ready for your first article</h2><p>Sign in and publish a note, how-to paper, or tech update.</p></article>";
            return;
        }

        postsElement.innerHTML = posts.map((post) => {
            const category = escapeHtml(post.category || "Note");
            const title = escapeHtml(post.title || "Untitled Post");
            const summary = escapeHtml(post.summary || "");
            const content = renderContent(post.content, post.attachments);
            const date = escapeHtml(formatDate(post.createdAt));
            const attachmentSection = renderAttachments(post.attachments, post.content);
            const actionButtons = currentUser && post.id
                ? `<div class="post-actions"><button type="button" class="btn btn-secondary" data-edit-id="${escapeHtml(post.id)}">Modify Post</button><button type="button" class="btn btn-danger" data-delete-id="${escapeHtml(post.id)}">Delete Post</button></div>`
                : "";

            return `
                <article class="post-card">
                    <div class="meta">${category} • ${date}</div>
                    <h2>${title}</h2>
                    <p>${summary}</p>
                    ${content ? `<div class="post-content">${content}</div>` : ""}
                    ${attachmentSection}
                    ${actionButtons}
                </article>
            `;
        }).join("");
    }

    function isConfigured(config) {
        return !!config &&
            !!config.apiKey && !String(config.apiKey).includes("YOUR_") &&
            !!config.projectId && !String(config.projectId).includes("YOUR_");
    }

    const config = window.firebaseBlogConfig || {};

    if (typeof firebase === "undefined" || !isConfigured(config)) {
        renderPosts(demoPosts);
        setStatus("Preview mode is active. Add your blog settings to enable live posting.", false);
        if (loginPanel) {
            loginPanel.hidden = false;
        }
        if (editorPanel) {
            editorPanel.hidden = true;
        }
        if (userState) {
            userState.textContent = "Preview mode is active.";
        }
        return;
    }

    firebase.initializeApp(config);
    const auth = firebase.auth();
    const db = firebase.firestore();
    const storage = typeof firebase.storage === "function" ? firebase.storage() : null;
    let unsubscribe;

    function canEdit(user) {
        return !!user;
    }

    function clearIdleTimer() {
        if (idleTimer) {
            window.clearTimeout(idleTimer);
            idleTimer = null;
        }
    }

    function startIdleTimer() {
        clearIdleTimer();

        if (!currentUser) {
            return;
        }

        idleTimer = window.setTimeout(async () => {
            try {
                await auth.signOut();
                setStatus("Signed out after inactivity.", false);
            } catch (error) {
                console.error(error);
                setStatus("Auto sign-out failed.", true);
            }
        }, idleLimitMs);
    }

    function bindActivityTracking() {
        ["click", "keydown", "mousemove", "scroll", "touchstart"].forEach((eventName) => {
            document.addEventListener(eventName, () => {
                if (currentUser) {
                    startIdleTimer();
                }
            }, { passive: true });
        });
    }

    function subscribeToPosts() {
        if (unsubscribe) {
            unsubscribe();
        }

        unsubscribe = db.collection("posts").orderBy("createdAt", "desc").onSnapshot((snapshot) => {
            const posts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            cachedPosts = posts;
            renderPosts(posts);
            setStatus(posts.length ? "Posts loaded successfully." : "You are connected and ready to publish your first post.", false);
        }, (error) => {
            console.error(error);
            renderPosts(demoPosts);
            setStatus("Posts could not be loaded. Check your Firestore settings.", true);
        });
    }

    subscribeToPosts();
    bindActivityTracking();
    bindClipboardPaste();

    auth.onAuthStateChanged((user) => {
        currentUser = user;
        renderPosts(cachedPosts);

        if (canEdit(user)) {
            startIdleTimer();

            if (loginPanel) {
                loginPanel.hidden = true;
            }
            if (editorPanel) {
                editorPanel.hidden = false;
            }
            if (userState) {
                userState.textContent = `Signed in as ${user.email}`;
            }
            setStatus("You are signed in and ready to publish. Auto sign-out runs after 15 minutes of inactivity.", false);
            return;
        }

        clearIdleTimer();

        if (loginPanel) {
            loginPanel.hidden = false;
        }
        if (editorPanel) {
            editorPanel.hidden = true;
        }

        if (userState) {
            userState.textContent = "Sign in to publish posts.";
        }
    });

    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const email = loginForm.querySelector("[name=email]").value.trim();
            const password = loginForm.querySelector("[name=password]").value;

            try {
                setStatus("Signing in...", false);
                await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
                await auth.signInWithEmailAndPassword(email, password);
                loginForm.reset();
            } catch (error) {
                console.error(error);
                setStatus(error.message, true);
            }
        });
    }

    if (logoutButton) {
        logoutButton.addEventListener("click", async () => {
            await auth.signOut();
            resetEditorForm({ silent: true });
            setStatus("Signed out.", false);
        });
    }

    if (cancelEditButton) {
        cancelEditButton.addEventListener("click", () => {
            resetEditorForm({ silent: true });
            setStatus("Edit canceled.", false);
        });
    }

    if (postsElement) {
        postsElement.addEventListener("click", async (event) => {
            const editButton = event.target.closest("[data-edit-id]");
            if (editButton) {
                const editId = editButton.getAttribute("data-edit-id");
                const postToEdit = cachedPosts.find((post) => post.id === editId);

                if (!currentUser) {
                    setStatus("Sign in to modify posts.", true);
                    return;
                }

                if (postToEdit) {
                    loadPostIntoEditor(postToEdit);
                }
                return;
            }

            const button = event.target.closest("[data-delete-id]");
            if (!button) {
                return;
            }

            const postId = button.getAttribute("data-delete-id");
            if (!postId) {
                return;
            }

            if (!currentUser) {
                setStatus("Sign in to delete posts.", true);
                return;
            }

            const confirmed = window.confirm("Delete this post?");
            if (!confirmed) {
                return;
            }

            const postToDelete = cachedPosts.find((post) => post.id === postId);

            try {
                setStatus("Deleting post...", false);

                if (storage && postToDelete && Array.isArray(postToDelete.attachments)) {
                    await Promise.allSettled(postToDelete.attachments.map((attachment) => {
                        if (!attachment || !attachment.path) {
                            return Promise.resolve();
                        }

                        return storage.ref().child(attachment.path).delete();
                    }));
                }

                await db.collection("posts").doc(postId).delete();

                if (currentEditingPostId === postId) {
                    resetEditorForm({ silent: true });
                }

                setStatus("Post deleted successfully.", false);
            } catch (error) {
                console.error(error);
                setStatus(error.message, true);
            }
        });
    }

    if (postForm) {
        postForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const title = postForm.querySelector("[name=title]").value.trim();
            const category = postForm.querySelector("[name=category]").value.trim();
            const summary = postForm.querySelector("[name=summary]").value.trim();
            syncContentInput();
            const content = postForm.querySelector("[name=content]").value.trim();
            const attachmentInput = postForm.querySelector("[name=attachments]");
            const selectedFiles = Array.from(pendingAttachmentFiles || []).slice(0, 5);

            if (!title || !summary) {
                setStatus("Title and summary are required.", true);
                return;
            }

            try {
                const isEditing = !!currentEditingPostId;
                const existingPost = isEditing ? cachedPosts.find((post) => post.id === currentEditingPostId) : null;
                const existingAttachments = existingPost && Array.isArray(existingPost.attachments) ? existingPost.attachments : [];
                const hasAttachments = selectedFiles.length > 0;

                if (selectedFiles.length > 5) {
                    setStatus("Up to 5 file attachments are allowed per post.", true);
                    return;
                }

                if (hasAttachments) {
                    setStatus(isEditing ? "Uploading attachments for the update..." : "Uploading attachments...", false);
                }

                const uploadedFiles = selectedFiles.length ? await uploadAttachments(selectedFiles) : [];
                const attachmentMap = new Map();

                [...existingAttachments, ...uploadedFiles].forEach((attachment) => {
                    if (!attachment || !attachment.url) {
                        return;
                    }

                    const key = String(attachment.id || attachment.name || Math.random()).toLowerCase();
                    attachmentMap.set(key, attachment);
                });

                const attachments = Array.from(attachmentMap.values());
                const savedContent = buildPersistedEditorContent(attachments) || renderContent(content, attachments);
                const storedAttachments = attachments.filter((attachment) => {
                    if (!attachment || !attachment.url) {
                        return false;
                    }

                    const type = String(attachment.type || "").toLowerCase();
                    const url = String(attachment.url || "").trim().toLowerCase();

                    if (type.startsWith("image/") && url && savedContent.toLowerCase().includes(url)) {
                        return false;
                    }

                    return true;
                });

                setStatus(isEditing ? "Updating post..." : (hasAttachments ? "Publishing post with attachments..." : "Publishing post..."), false);

                if (isEditing) {
                    await db.collection("posts").doc(currentEditingPostId).update({
                        title,
                        category: category || "Note",
                        summary,
                        content: savedContent,
                        attachments: storedAttachments,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                } else {
                    await db.collection("posts").add({
                        title,
                        category: category || "Note",
                        summary,
                        content: savedContent,
                        attachments: storedAttachments,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }

                resetEditorForm({ silent: true });
                setStatus(isEditing ? "Post updated successfully." : ((storedAttachments.length || hasAttachments) ? "Post and attachments published successfully." : "Post published successfully."), false);
            } catch (error) {
                console.error(error);
                setStatus(error.message, true);
            }
        });
    }
})();
