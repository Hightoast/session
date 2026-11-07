
import { createRoot } from "react-dom/client";
import { FallingLeaves } from "falling-leaves/react";

const root = document.getElementById("leaves-root");

if (root) {
  createRoot(root).render(
    <FallingLeaves fullscreen numberOfLeaves={25} shapes={["maple"]} />
  );
}