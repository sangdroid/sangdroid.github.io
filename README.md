# sangdroid

This repository contains the source for the personal website and portfolio for "Sangdroid". The site is a small static site (HTML, CSS, JavaScript) served via GitHub Pages.

## Local preview
To preview the site locally, open `index.html` in your browser or run a simple static server from the repository root. Example using Python 3:

```powershell
# from repository root
python -m http.server 8000
# then open http://localhost:8000 in your browser
```

## Deployment
This repository is configured to publish via GitHub Pages from the `main` branch (root). When you push changes to `main`, GitHub Pages serves the updated site at `https://sangdroid.github.io`.

If you make changes that don't appear immediately on the live site, try:

- Hard-refresh your browser (Ctrl+F5) or open a private window.
- Trigger a Pages rebuild by creating an empty commit and pushing:

```powershell
git commit --allow-empty -m "Trigger GitHub Pages rebuild"
git push
```

## Contact
Contact the repository owner.

