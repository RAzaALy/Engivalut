/**
 * Root-first breadcrumb trail. Structurally matches EmDash's own
 * `BreadcrumbItem` (`{ name, url }`) so it can be passed straight through
 * to `createPublicPageContext({ breadcrumbs })` for structured data as well
 * as rendered by the visible `Breadcrumbs` component — no separate model.
 */
export interface BreadcrumbItem {
	name: string;
	url: string;
}
