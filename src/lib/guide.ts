/**
 * The illustrated user guide, served as static files from public/guide/
 * (source edition: visual-user-guide-2026-09-24/). Resolved against the
 * hosting base so it works on both Pages (/timetable-pwa/) and Vercel (/).
 */
export const USER_GUIDE_HTML = `${import.meta.env.BASE_URL}guide/my-timetable-guide.html`
export const USER_GUIDE_PDF = `${import.meta.env.BASE_URL}guide/my-timetable-guide.pdf`
