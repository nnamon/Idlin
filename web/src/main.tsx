import { createRoot } from "react-dom/client";
import { NetClient } from "./net/client";
import { WorldStore } from "./world/store";
import { ZoneRenderer } from "./scene/ZoneRenderer";
import { Overlay } from "./ui/Overlay";

const wsProto = location.protocol === "https:" ? "wss" : "ws";
const store = new WorldStore();
const client = new NetClient(`${wsProto}://${location.host}/ws`);
client.onMessage((msg) => store.handle(msg));
client.start();

new ZoneRenderer(document.getElementById("scene")!, store);

createRoot(document.getElementById("overlay")!).render(
  <Overlay client={client} store={store} />,
);
