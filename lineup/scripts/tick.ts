import { tick } from "../src/lib/service";
tick().then((l) => { console.log(l.length ? l.join("\n") : "nothing to do"); process.exit(0); });
