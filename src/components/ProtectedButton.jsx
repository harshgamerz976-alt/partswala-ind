import { useAuth } from "../context/useAuth";
import { useNavigate } from "react-router-dom";

export default function ProtectedButton({ children, to: _to, onClick, className = "" }) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  function handleClick(e) {
    if (!currentUser) {
      navigate("/login");
      return;
    }
    if (onClick) onClick(e);
  }

  return (
    <button onClick={handleClick} className={className}>
      {children}
    </button>
  );
}