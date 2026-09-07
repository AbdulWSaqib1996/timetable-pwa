# Admin analytics development handoff

Start with [ADMIN_ANALYTICS_ENHANCEMENTS.md](ADMIN_ANALYTICS_ENHANCEMENTS.md). It contains the source audit, prioritized bugs, exact UI styling rules, metric/API contracts, migration plan, five development phases and acceptance tests.

Open [admin-analytics-designs.html](admin-analytics-designs.html) in a browser for side-by-side desktop/mobile comparisons, dark-theme designs and new-feature screens. Use [mockup.html](mockup.html) for the interactive prototype. Keep this folder intact: the gallery uses its local images and prototype file. No server or internet connection is required.

Quick image references:

- [Desktop before/after](assets/comparison-desktop.png)
- [Mobile before/after](assets/comparison-mobile.png)
- [Feature adoption](assets/after-adoption.png)
- [Return cohorts](assets/after-returning.png)
- [Reliability](assets/after-reliability.png)
- [Release coverage](assets/after-releases.png)
- [Data and access](assets/after-access.png)

All data is synthetic. Before images render the reviewed current page; after images are proposals. This package does not implement or deploy the admin redesign. No production credentials or analytics were accessed.

The `evidence` folder records the reviewed commit/file hashes, locally reproduced defects, fixture data and design checks. The HTML source reference has a `.txt` extension intentionally; do not rename it and run it against production. The app was undergoing concurrent development, so re-read current source and AGENTS.md before starting A1.
