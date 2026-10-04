/**
 * Plugin Commons panel page.
 *
 * A self-contained React component: it fetches the host API, renders the
 * plugin catalogue, and installs or removes a plugin through the host's
 * management endpoints. It deliberately avoids the UI-primitives component
 * library so the browser half stays small and dependency-light.
 *
 * Installing a plugin changes the application's plugin tree, including this
 * panel's own client bundle, so a successful operation ends in one page reload
 * rather than pretending the running page is still current.
 */
export declare function PluginCommonsPage(): JSX.Element;
