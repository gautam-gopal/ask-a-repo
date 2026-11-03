import { useParams } from "react-router-dom";

export default function ChatPage() {
  const { id } = useParams();
  return (
    <>
      <h1>Chat</h1>
      <p className="muted">Coming in 8C. Repository id: {id}</p>
    </>
  );
}
