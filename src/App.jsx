import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const socket = io(import.meta.env.VITE_SOCKET_URL ?? "http://localhost:3001", {
  autoConnect: false,
});

function getInitialName() {
  try {
    return window.localStorage.getItem("gather-name") ?? "";
  } catch {
    return "";
  }
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function Avatar({ name, small = false }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const colorIndex = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;

  return (
    <span className={`avatar avatar-${colorIndex}${small ? " avatar-small" : ""}`}>
      {initials || "?"}
    </span>
  );
}

export default function App() {
  const [name, setName] = useState(getInitialName);
  const [draftName, setDraftName] = useState(getInitialName);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [directMessages, setDirectMessages] = useState({});
  const [activeConversation, setActiveConversation] = useState(null);
  const [dmError, setDmError] = useState("");
  const [text, setText] = useState("");
  const [onlineCount, setOnlineCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const nameRef = useRef(name);
  const visibleMessages = activeConversation
    ? directMessages[activeConversation]?.messages ?? []
    : messages;
  const activePeerName = activeConversation
    ? members.find((member) => member.id === activeConversation)?.name ??
      directMessages[activeConversation]?.name ??
      "Direct message"
    : "";

  useEffect(() => {
    socket.on("connect", () => {
      setConnected(true);
      if (nameRef.current) socket.emit("chat:join", nameRef.current);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("chat:history", (history) => setMessages(history));
    socket.on("chat:message", (message) => {
      setMessages((current) => [...current, message]);
    });
    socket.on("chat:system", (event) => {
      setMessages((current) => [...current, event]);
    });
    socket.on("chat:online", setOnlineCount);
    socket.on("chat:members", setMembers);
    socket.on("dm:history", ({ peerId, peerName, messages: history }) => {
      setDirectMessages((current) => ({
        ...current,
        [peerId]: { name: peerName, messages: history },
      }));
    });
    socket.on("dm:message", ({ peerId, peerName, message }) => {
      setDirectMessages((current) => {
        const thread = current[peerId] ?? { name: peerName, messages: [] };
        return {
          ...current,
          [peerId]: {
            ...thread,
            name: peerName,
            messages: [...thread.messages, message],
          },
        };
      });
    });
    socket.on("dm:error", setDmError);
    socket.connect();

    return () => {
      socket.disconnect();
      socket.removeAllListeners();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages]);

  useEffect(() => {
    setText("");
    setDmError("");
  }, [activeConversation]);

  function joinChat(event) {
    event.preventDefault();
    const trimmedName = draftName.trim().slice(0, 24);
    if (!trimmedName) return;
    nameRef.current = trimmedName;
    setName(trimmedName);
    try {
      window.localStorage.setItem("gather-name", trimmedName);
    } catch {
      // The current session can still chat when browser storage is unavailable.
    }
    socket.emit("chat:join", trimmedName);
    inputRef.current?.focus();
  }

  function sendMessage(event) {
    event.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText || !name || !connected) return;
    if (activeConversation) {
      socket.emit("dm:message", { to: activeConversation, text: trimmedText });
    } else {
      socket.emit("chat:message", trimmedText);
    }
    setText("");
    inputRef.current?.focus();
  }

  function openDirectMessage(member) {
    setDirectMessages((current) => ({
      ...current,
      [member.id]: current[member.id] ?? { name: member.name, messages: [] },
    }));
    setActiveConversation(member.id);
    socket.emit("dm:open", member.id);
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Gather home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 28 28" fill="none">
              <path d="M5 7.5h18v12H13l-5 4v-4H5v-12Z" />
              <path d="M10 12h8M10 15.5h5" />
            </svg>
          </span>
          <span>gather<span className="brand-period">.</span></span>
        </a>
        <div className={`connection ${connected ? "is-connected" : ""}`}>
          <span className="connection-dot" />
          {connected ? "Connected" : "Connecting"}
        </div>
      </header>

      <section className="chat-layout" aria-label="Chat room">
        <aside className="room-sidebar">
          <div className="sidebar-label">CHANNELS</div>
          <button
            className={`room-item ${activeConversation === null ? "active" : ""}`}
            type="button"
            onClick={() => setActiveConversation(null)}
          >
            <span className="hash-icon">#</span>
            <span>general</span>
            {activeConversation === null && <span className="room-active-dot" />}
          </button>
          {name && (
            <>
              <div className="sidebar-label people-label">PEOPLE ONLINE</div>
              <div className="member-list">
                {members.filter((member) => member.id !== socket.id).length === 0 ? (
                  <p className="no-members">No one else is here yet.</p>
                ) : (
                  members
                    .filter((member) => member.id !== socket.id)
                    .map((member) => (
                      <button
                        className={`member-item ${activeConversation === member.id ? "active" : ""}`}
                        key={member.id}
                        type="button"
                        onClick={() => openDirectMessage(member)}
                        aria-label={`Start a private message with ${member.name}`}
                      >
                        <Avatar name={member.name} small />
                        <span className="member-name">{member.name}</span>
                        <span className="member-online" />
                      </button>
                    ))
                )}
              </div>
              {Object.entries(directMessages).length > 0 && (
                <>
                  <div className="sidebar-label people-label">DIRECT MESSAGES</div>
                  <div className="member-list">
                    {Object.entries(directMessages).map(([peerId, thread]) => (
                      <button
                        className={`member-item ${activeConversation === peerId ? "active" : ""}`}
                        key={peerId}
                        type="button"
                        onClick={() => setActiveConversation(peerId)}
                      >
                        <Avatar name={thread.name} small />
                        <span className="member-name">{thread.name}</span>
                        {members.some((member) => member.id === peerId) && (
                          <span className="member-online" />
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          <div className="sidebar-note">
            <span className="note-icon">✳</span>
            <p>A little corner of the internet to catch up.</p>
          </div>
          <div className="sidebar-footer">
            <span className="online-pulse" />
            <span>{onlineCount} {onlineCount === 1 ? "person" : "people"} here</span>
          </div>
        </aside>

        <section className="chat-panel">
          <div className="room-header">
            <div className="room-heading">
              <span className="hash-icon header-hash">
                {activeConversation ? "↗" : "#"}
              </span>
              <div>
                <h1>{activeConversation ? activePeerName : "general"}</h1>
                <p>
                  {activeConversation
                    ? "A private conversation between just the two of you."
                    : "The place for everything and everyone."}
                </p>
              </div>
            </div>
            <div className="room-count">
              {activeConversation ? (
                <><span className="lock-icon">●</span> PRIVATE</>
              ) : (
                <><span className="online-pulse" />{onlineCount}</>
              )}
            </div>
          </div>

          {!name ? (
            <div className="welcome-state">
              <div className="welcome-icon">
                <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
                  <path d="M8 12h32v22H22l-9 7v-7H8V12Z" />
                  <path d="M17 20h14M17 26h9" />
                </svg>
              </div>
              <p className="eyebrow">A GOOD PLACE TO START</p>
              <h2>Come on in.</h2>
              <p className="welcome-copy">Pick a name and say hello to the room.</p>
              <form className="name-form" onSubmit={joinChat}>
                <label className="sr-only" htmlFor="display-name">Your name</label>
                <input
                  id="display-name"
                  autoFocus
                  maxLength={24}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="What should we call you?"
                  value={draftName}
                />
                <button type="submit" disabled={!connected || !draftName.trim()}>
                  Join the chat <span aria-hidden="true">→</span>
                </button>
              </form>
              <p className="fine-print">No account needed. Just good conversation.</p>
            </div>
          ) : (
            <>
              <div
                className="message-list"
                aria-live="polite"
                aria-label={activeConversation ? `Private messages with ${activePeerName}` : "Messages"}
              >
                {visibleMessages.length === 0 ? (
                  <div className="empty-messages">
                    <span>✳</span>
                    <p>
                      {activeConversation
                        ? `Say hello to ${activePeerName}. Only the two of you can see this conversation.`
                        : "It’s quiet in here. Start the conversation."}
                    </p>
                  </div>
                ) : (
                  <>
                    {!activeConversation && <div className="history-note">YOU’RE ALL CAUGHT UP</div>}
                    {visibleMessages.map((message) => (
                      <article
                        className={`message ${message.name === name ? "own-message" : ""} ${
                          message.id.startsWith("system-") ? "system-message" : ""
                        }`}
                        key={message.id}
                      >
                        {message.name ? (
                          <>
                            <Avatar name={message.name} small />
                            <div className="message-body">
                              <div className="message-meta">
                                <strong>{message.name}</strong>
                                <time dateTime={message.time}>{formatTime(message.time)}</time>
                              </div>
                              <p>{message.text}</p>
                            </div>
                          </>
                        ) : (
                          <p>{message.text}</p>
                        )}
                      </article>
                    ))}
                    <div ref={bottomRef} />
                  </>
                )}
              </div>
              <form className="composer" onSubmit={sendMessage}>
                <label className="sr-only" htmlFor="message-input">Write a message</label>
                <input
                  id="message-input"
                  maxLength={1000}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={activeConversation ? `Message ${activePeerName} privately` : "Message #general"}
                  ref={inputRef}
                  value={text}
                  disabled={!connected}
                />
                <span className="composer-hint">↵</span>
                <button
                  className="send-button"
                  type="submit"
                  aria-label="Send message"
                  disabled={!text.trim() || !connected}
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m21 3-7.2 18-3.4-7.4L3 10.2 21 3Z" />
                    <path d="M10.4 13.6 15 9" />
                  </svg>
                </button>
              </form>
              {dmError && activeConversation && (
                <p className="dm-error" role="status">{dmError}</p>
              )}
              <div className="chat-footer">
                <span>
                  {activeConversation
                    ? "Your direct messages aren’t posted in #general."
                    : <>Having a good conversation? Keep it kind. <span aria-hidden="true">♡</span></>}
                </span>
                <button
                  className="change-name"
                  type="button"
                  onClick={() => {
                    setDraftName(name);
                    setName("");
                  }}
                >
                  Change name
                </button>
              </div>
            </>
          )}
        </section>
      </section>
      <footer className="page-footer">MADE FOR THE MOMENTS IN BETWEEN <span>✳</span></footer>
    </main>
  );
}
