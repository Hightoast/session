import { createRoot } from "react-dom/client";
import Snowfall from "react-snowfall";

const root = document.getElementById("leaves-root");

if (root) {
  // 1. Create a native Image instance
  const img = new Image();

  const start = (loadedImages) =>
    createRoot(root).render(
      <Snowfall
        snowflakeCount={200}
        speed={[0, 1]}
        wind={[-0.5, 0.5]}
        radius={[8, 22.5]}
        rotationSpeed={[-1, 1]}
        images={loadedImages}
        style={{
          filter: 'blur(2px)', // Blurs the entire snowfall effect
          opacity: 0.6         // Softens the look further
        }}
      />
    );

  // 2. Bind the load handlers directly to the image object
  // react-snowfall expects an array of CanvasImageSource elements
  img.onload = () => start([img]);     
  img.onerror = () => start(undefined); // Pass undefined or omit to fall back to circles

  // 3. Set the source from the dataset to trigger the load
  img.src = root.dataset.image || '/static/img/snowflake.png';
}
