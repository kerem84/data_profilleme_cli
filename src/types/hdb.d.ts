declare module 'hdb' {
  interface ClientOptions {
    host: string;
    port: number;
    user: string;
    password: string;
  }

  interface Statement {
    exec(params: unknown[], callback: (err: Error | null, rows: Record<string, unknown>[]) => void): void;
    drop(callback?: (err: Error | null) => void): void;
  }

  interface Client {
    connect(callback: (err: Error | null) => void): void;
    disconnect(callback?: () => void): void;
    exec(sql: string, callback: (err: Error | null, rows: Record<string, unknown>[]) => void): void;
    exec(sql: string, params: unknown[], callback: (err: Error | null, rows: Record<string, unknown>[]) => void): void;
    prepare(sql: string, callback: (err: Error | null, statement: Statement) => void): void;
  }

  function createClient(options: ClientOptions): Client;

  export default { createClient };
  export { Client, ClientOptions, createClient };
}
