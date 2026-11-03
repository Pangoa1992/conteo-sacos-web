import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// En desarrollo, si DATABASE_URL no está configurada todavía,
// evitamos que falle toda la app al importar este archivo.
const connectionString = process.env.DATABASE_URL ?? "";

// Una sola conexión, con límites de tiempo para que una consulta, una transacción
// abandonada o una conexión caída nunca dejen la aplicación esperando indefinidamente:
// la petición falla con un error y la siguiente usa una conexión nueva.
const client = postgres(connectionString, {
  max: 1,
  connect_timeout: 10, // s para establecer la conexión
  idle_timeout: 60, // s sin uso: se cierra y se abre otra al necesitarla
  max_lifetime: 30 * 60, // s: renovación periódica de la conexión
  connection: {
    application_name: "conteo-sacos-web",
    statement_timeout: 15_000, // ms por consulta
    idle_in_transaction_session_timeout: 15_000, // ms: libera una transacción que quedó abierta
  },
});
export const db = drizzle(client, { schema });
