import "./index.css";
import { Composition } from "remotion";
import { SerenityDemo } from "./SerenityDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="SerenityDemo"
      component={SerenityDemo}
      durationInFrames={3000}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
