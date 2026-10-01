// Keep notices in third_party like the other bundled dependencies. Copy them
// after Vite builds so web, container and npm distributions include them too.
import { cpSync } from "node:fs";

cpSync(new URL("../third_party/novnc/", import.meta.url), new URL("../dist/licenses/novnc/", import.meta.url), { recursive: true });
