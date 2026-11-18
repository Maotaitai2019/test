import { createRoot } from "react-dom/client";
import DinnerPoll from "./app/poll";
import "./app/globals.css";
createRoot(document.getElementById("root")!).render(<DinnerPoll/>);
