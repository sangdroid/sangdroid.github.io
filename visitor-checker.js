(function () {
    const namespace = "sangdroid-github-io";
    const baseUrl = "https://api.countapi.xyz";

    function normalizePath(pathname) {
        const value = pathname === "/" ? "index" : pathname;
        return value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "index";
    }

    function updateText(selector, text) {
        document.querySelectorAll(selector).forEach((element) => {
            element.textContent = text;
        });
    }

    async function hitCounter(key) {
        const response = await fetch(`${baseUrl}/hit/${namespace}/${key}`);
        if (!response.ok) {
            throw new Error(`Counter request failed: ${response.status}`);
        }
        const data = await response.json();
        return data.value;
    }

    async function loadVisitors() {
        try {
            const totalCount = await hitCounter("site-total");

            updateText("[data-visitor-total]", totalCount.toLocaleString());
            console.log("Visitor checker", { totalCount });
        } catch (error) {
            updateText("[data-visitor-total]", "N/A");
            console.warn("Visitor checker unavailable", error);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", loadVisitors);
    } else {
        loadVisitors();
    }
})();
