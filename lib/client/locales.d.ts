/**
 * Dictionaries for the Plugin Commons panel.
 *
 * Registration mechanics follow `dsh-agent-teams`: the plugin calls
 * `ctx.locale.register(NS, { zh, en })` and every registration site that
 * declares `locale: NS` receives the framework's typed `t` seat.
 */
/** Dictionary namespace owned by the Plugin Commons client plugin. */
export declare const NS = "pluginCommons";
declare const zhDictionary: {
    panel: string;
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    clearSearch: string;
    categoryAll: string;
    loading: string;
    empty: string;
    emptyHint: string;
    emptySearch: string;
    retry: string;
    refresh: string;
    stars: string;
    forks: string;
    language: string;
    updated: string;
    openRepo: string;
    count: string;
    total: string;
    disclaimer: string;
    'sort.stars': string;
    'sort.forks': string;
    'sort.updated': string;
};
/** Simplified Chinese dictionary. */
export declare const zh: Record<string, string>;
/** English dictionary, typed against the Chinese key union. */
export declare const en: Record<keyof typeof zhDictionary, string>;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        pluginCommons: string;
    }
}
export {};
