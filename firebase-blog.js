(function () {
    const statusElement = document.querySelector("[data-blog-status]");
    const postsElement = document.querySelector("[data-post-list]");
    const loginPanel = document.querySelector("[data-login-panel]");
    const editorPanel = document.querySelector("[data-editor-panel]");
    const loginForm = document.querySelector("[data-login-form]");
    const postForm = document.querySelector("[data-post-form]");
    const userState = document.querySelector("[data-user-state]");
    const logoutButton = document.querySelector("[data-logout]");

    const demoPosts = [
        {
            category: "How-To Paper",
            title: "Welcome to the Firebase Study Board",
            summary: "Once Firebase is connected, new posts that you publish from this page will appear here automatically.",
            content: "This starter board already supports sign-in, article publishing, and live post loading from Firestore.",
            createdAt: new Date()
        }
    ];

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

            return `
                <article class="post-card">
                    <div class="meta">${category} • ${date}</div>
                    <h2>${title}</h2>
                    <p>${summary}</p>
                    ${content ? `<div class="post-content">${content}</div>` : ""}
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
        setStatus("Demo mode is active. Add your Firebase project values to firebase-config.js to enable live posting.", false);
        if (loginPanel) {
            loginPanel.hidden = false;
        }
        if (editorPanel) {
            editorPanel.hidden = true;
        }
        if (userState) {
            userState.textContent = "Firebase is not connected yet.";
        }
        return;
    }

    firebase.initializeApp(config);
    const auth = firebase.auth();
    const db = firebase.firestore();
    let unsubscribe;

    function isAdmin(user) {
        return !!user && (!config.adminEmail || user.email === config.adminEmail);
    }

    function subscribeToPosts() {
        if (unsubscribe) {
            unsubscribe();
        }

        unsubscribe = db.collection("posts").orderBy("createdAt", "desc").onSnapshot((snapshot) => {
            const posts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            renderPosts(posts);
            setStatus(posts.length ? "Live posts loaded from Firebase." : "Connected to Firebase. Publish your first post.", false);
        }, (error) => {
            console.error(error);
            renderPosts(demoPosts);
            setStatus("Firebase connected, but posts could not be loaded. Check Firestore rules.", true);
        });
    }

    subscribeToPosts();

    auth.onAuthStateChanged((user) => {
        if (isAdmin(user)) {
            if (loginPanel) {
                loginPanel.hidden = true;
            }
            if (editorPanel) {
                editorPanel.hidden = false;
            }
            if (userState) {
                userState.textContent = `Signed in as ${user.email}`;
            }
            setStatus("You are signed in and can publish posts.", false);
            return;
        }

        if (loginPanel) {
            loginPanel.hidden = false;
        }
        if (editorPanel) {
            editorPanel.hidden = true;
        }

        if (userState) {
            userState.textContent = user ? `Signed in as ${user.email} (read-only)` : "Sign in to publish posts.";
        }
    });

    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const email = loginForm.querySelector("[name=email]").value.trim();
            const password = loginForm.querySelector("[name=password]").value;

            try {
                setStatus("Signing in...", false);
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
