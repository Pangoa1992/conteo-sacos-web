import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// En desarrollo, si DATABASE_URL no está configurada todavía,
// evitamos que falle toda la app al importar este archivo.
const connectionString = process.env.DATABASE_URL ?? "";

const client = postgres(connectionString, { max: 1 });
export const db = drizzle(client, { schema });
