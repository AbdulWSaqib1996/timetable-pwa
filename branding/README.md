# Timetable and admin icon family

The timetable uses an indigo calendar with session blocks. Admin retains the calendar silhouette and uses analytics bars on navy. Colours match the updated interface: indigo #3e51c7, navy #202940, soft indigo #eef0ff and green #196c54.

Open `icon-preview.png` or `icon-preview.svg` for both designs. The preview shows an illustrative rounded launcher crop; actual launcher masks are controlled by the operating system. Public PNG artwork is opaque and square, with all essential artwork within the central maskable safe circle. Dedicated maskable filenames are intentional, even though the same safe composition currently works for ordinary icons.

## Assets and wiring

- Main app: `public/app-icon.svg`, `public/favicon.svg`, `public/favicon.ico`, PNG favicons 16/32/48, Apple touch icon 180, standard and maskable icons 192/512.
- Admin: the equivalent independent files under `public/admin/`.
- Editable vector masters: each `app-icon.svg`. Favicons use a simplified timetable grid for small sizes.
- Large exports: `branding/timetable-icon-1024.png` and `branding/admin-icon-1024.png`.
- Main HTML and Vite manifest reference the timetable family; analytics HTML and manifest reference the admin family. Existing start URLs/scopes and service-worker registration behaviour are preserved.

Regenerate from repository root using `node scripts/generate-app-icons.mjs` with the `sharp` package available. Alternatively set `TIMETABLE_ICON_SHARP_MODULE` to the absolute path of an existing Sharp ES module. No dependency was added to the application. SVG files can also be edited/exported in a vector editor. The generated PNG and ICO files are committed assets; normal app builds do not run the generator.

`icon-validation.json` records dimensions and a pixel-based maskable-safe-circle check. ICO containers hold 16/32/48 PNG images. Browser/launcher icon caches may update on a different schedule from page content; an installed OS shortcut can retain its previous icon until the platform refreshes it. This change is prepared locally and does not itself deploy the app.
