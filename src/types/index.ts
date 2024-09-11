export interface proxyType {
    protocol: string;
    host: string;
    port: number;
    auth?: { username: string, password: string };
}