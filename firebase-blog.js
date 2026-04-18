(function () {
    const statusElement = document.querySelector("[data-blog-status]");
    const postsElement = document.querySelector("[data-post-list]");
    const loginPanel = document.querySelector("[data-login-panel]");
    const editorPanel = document.querySelector("[data-editor-panel]");
    const loginForm = document.querySelector("[data-login-form]");
    const postForm = document.querySelector("[data-post-form]");
    const userState = document.querySelector("[data-user-state]");
    const logoutButton = document.querySelector("[data-logout]");
    let currentUser = null;
    let cachedPosts = [];
    let idleTimer = null;
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
            const content = escapeHtml(post.content || "").replace(/\n/g, "<br>");
            const date = escapeHtml(formatDate(post.createdAt));
            const deleteButton = currentUser && post.id
                ? `<div class="post-actions"><button type="button" class="btn btn-danger" data-delete-id="${escapeHtml(post.id)}">Delete Post</button></div>`
                : "";

            return `
                <article class="post-card">
                    <div class="meta">${category} • ${date}</div>
                    <h2>${title}</h2>
                    <p>${summary}</p>
                    ${content ? `<div class="post-content">${content}</div>` : ""}
                    ${deleteButton}
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
            setStatus("Signed out.", false);
        });
    }

    if (postsElement) {
        postsElement.addEventListener("click", async (event) => {
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

            try {
                setStatus("Deleting post...", false);
                await db.collection("posts").doc(postId).delete();
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
            const content = postForm.querySelector("[name=content]").value.trim();

            if (!title || !summary) {
                setStatus("Title and summary are required.", true);
                return;
            }

            try {
                setStatus("Publishing post...", false);
                await db.collection("posts").add({
                    title,
                    category: category || "Note",
                    summary,
                    content,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                postForm.reset();
                setStatus("Post published successfully.", false);
            } catch (error) {
                console.error(error);
                setStatus(error.message, true);
            }
        });
    }
})();
