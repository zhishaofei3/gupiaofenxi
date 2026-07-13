import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import QuantAnalysis from "@/pages/QuantAnalysis";
import DeclineScreening from "@/pages/DeclineScreening";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/quant" element={<QuantAnalysis />} />
        <Route path="/decline" element={<DeclineScreening />} />
      </Routes>
    </Router>
  );
}
