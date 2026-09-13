/** Resolved media reference from getSiteSettings() */
export interface MediaReference {
	mediaId: string;
	alt?: string;
	url?: string;
}

export interface EngiVaultSiteIdentitySettings {
	title?: string;
	tagline?: string;
	logo?: MediaReference;
}

const DEFAULT_SITE_TITLE = "EngiVault";
const DEFAULT_SITE_TAGLINE = "AI Engineering Knowledge Hub";

export function resolveSiteIdentity(settings?: EngiVaultSiteIdentitySettings) {
	return {
		siteTitle: settings?.title ?? DEFAULT_SITE_TITLE,
		siteTagline: settings?.tagline ?? DEFAULT_SITE_TAGLINE,
		siteLogo: settings?.logo?.url ? settings.logo : null,
	};
}
