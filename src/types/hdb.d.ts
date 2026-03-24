declare module 'hdb' {
  interface ClientOptions {
    host: string;
    port: number;
    user: string;
    password: string;
  }

  interface Client {
    connect(callback: (err: Error | null) => void): void;
    disconnect(callback?: () => void): void;
    exec(sql: string, callback: (err: Error | null, rows: Record<string, unknown>[]) => void): void;
    exec(sql: string, params: unknown[], callback: (err: Error | null, rows: Record<string, unknown>[]) => void): void;
  }

  function createClient(options: ClientOptions): Client;

  export default { createClient };
  export { Client, ClientOptions, createClient };
}
