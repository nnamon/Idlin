import { createRoot } from "react-dom/client";
import { NetClient } from "./net/client";
import { TestScene } from "./scene/TestScene";
import { Overlay } from "./ui/Overlay";

const wsProto = location.protocol === "https:" ? "wss" : "ws";
const client = new NetClient(`${wsProto}://${location.host}/ws`);
client.start();

new TestScene(document.getElementById("scene")!);

createRoot(document.getElementById("overlay")!).render(<Overlay client={client} />);
