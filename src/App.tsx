import { useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { io, type Socket } from "socket.io-client";

type RoomStatus = "waiting" | "playing" | "finished";
type PlayerColor = "white" | "black" | "spectator";

type MatchState = {
  roomId: string;
  status: RoomStatus;
  whiteName: string;
  blackName: string;
  fen: string;
  history: string[];
  currentTurn: "w" | "b";
  whiteTime: number;
  blackTime: number;
  increment: number;
  resultText: string | null;
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function formatMoveHistory(history: string[]) {
  const lines: string[] = [];
  for (let i = 0; i < history.length; i += 2) {
    const moveNumber = Math.floor(i / 2) + 1;
    const whiteMove = history[i];
    const blackMove = history[i + 1];
    lines.push(`${moveNumber}. ${whiteMove}${blackMove ? ` ${blackMove}` : ""}`);
  }
  return lines;
}

function createRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function App() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerColor, setPlayerColor] = useState<PlayerColor | null>(null);
  const [statusMessage, setStatusMessage] = useState("Enter name and room to host or join a match.");
  const [matchStatus, setMatchStatus] = useState<RoomStatus>("waiting");
  const [roomsList, setRoomsList] = useState<Array<{id:string;status:string;whiteName:string|null;blackName:string|null}>>([]);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authUsername, setAuthUsername] = useState("");
  const [authRole, setAuthRole] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [guestMode, setGuestMode] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [playerHistory, setPlayerHistory] = useState<any[]>([]);
  const [pairingMode, setPairingMode] = useState<"sequential" | "random" | "seeded" | "swiss">("sequential");
  const [seedValues, setSeedValues] = useState("");
  const [dashboardRooms, setDashboardRooms] = useState<any[]>([]);
  const [dashboardResults, setDashboardResults] = useState<any[]>([]);
  const [chatMessages, setChatMessages] = useState<{author:string;message:string;at:string}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [organizerPlayers, setOrganizerPlayers] = useState("");
  const [organizerResults, setOrganizerResults] = useState<any[]>([]);
  const [whiteName, setWhiteName] = useState("White");
  const [blackName, setBlackName] = useState("Black");
  const isLoggedIn = !!authToken || guestMode;
  const isAdmin = isLoggedIn && authRole === "organizer";
  const isPlayer = isLoggedIn && authRole === "player";
  const [fen, setFen] = useState("start");
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [currentTurn, setCurrentTurn] = useState<"w" | "b">("w");
  const [whiteTime, setWhiteTime] = useState(300);
  const [blackTime, setBlackTime] = useState(300);
  const [resultText, setResultText] = useState<string | null>(null);
  const [baseTime, setBaseTime] = useState(300);
  const [increment, setIncrement] = useState(2);
  
  // Auto-detect server URL: use env var if set, otherwise current origin
  const getServerUrl = () => {
    const envUrl = (import.meta.env.VITE_SERVER_URL as string) || "";
    if (envUrl) return envUrl;
    // For production, connect to same origin (Render will serve both)
    return typeof window !== "undefined" ? window.location.origin : "http://localhost:4000";
  };
  const serverUrl = getServerUrl();

  function applyRoomState(payload: MatchState) {
    setMatchStatus(payload.status);
    setFen(payload.fen || "start");
    setMoveHistory(payload.history || []);
    setCurrentTurn(payload.currentTurn || "w");
    setWhiteName(payload.whiteName || "White");
    setBlackName(payload.blackName || "Black");
    setWhiteTime(typeof payload.whiteTime === "number" ? payload.whiteTime : baseTime);
    setBlackTime(typeof payload.blackTime === "number" ? payload.blackTime : baseTime);
    setIncrement(typeof payload.increment === "number" ? payload.increment : increment);
    setResultText(payload.resultText ?? null);
  }

  useEffect(() => {
    const storedToken = localStorage.getItem("chessToken");
    const storedUsername = localStorage.getItem("chessUsername");
    const storedRole = localStorage.getItem("chessRole");
    if (storedToken) {
      setAuthToken(storedToken);
      setAuthUsername(storedUsername || "");
      setAuthRole(storedRole || null);
      setPlayerName(storedUsername || "");
    }
  }, []);

  useEffect(() => {
    const socketUrl = serverUrl || undefined;
    const socket = io(socketUrl, {
      transports: ["websocket"],
      ...(authToken ? { auth: { token: authToken } } : {}),
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setStatusMessage("Connected to tournament server.");
      fetchRooms().catch(() => {});
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setStatusMessage("Disconnected from server.");
    });

    socket.on("roomJoined", (payload: MatchState & { playerColor: PlayerColor }) => {
      setJoined(true);
      setRoomId(payload.roomId);
      setPlayerColor(payload.playerColor);
      applyRoomState(payload);
      setStatusMessage(`Joined room ${payload.roomId} as ${payload.playerColor}.`);
    });

    socket.on("roomUpdate", (payload: MatchState) => {
      applyRoomState(payload);
    });

    socket.on("roomsList", (list: any[]) => {
      setRoomsList(list || []);
    });

    socket.on("chatMessage", (m) => {
      setChatMessages((cur) => [...cur, m]);
    });

    socket.on("errorMessage", (message: string) => {
      setStatusMessage(message);
    });

    if (authToken && authRole === "player") {
      fetchPlayerHistory().catch(() => {});
    } else {
      setPlayerHistory([]);
    }

    return () => {
      socket.disconnect();
    };
  }, [authToken, authRole, guestMode]);

  const moveHistoryLines = useMemo(() => formatMoveHistory(moveHistory), [moveHistory]);

  function handleJoinRoom(targetRoomId: string) {
    if (!authToken && !guestMode) {
      setStatusMessage("Please log in first to join a match.");
      return;
    }
    if (!playerName.trim()) {
      setStatusMessage("Enter your player name before joining a match.");
      return;
    }

    const normalizedRoomId = targetRoomId.trim().toUpperCase();
    if (!normalizedRoomId) {
      setStatusMessage("Please provide a valid match ID or create a new match.");
      return;
    }

    socketRef.current?.emit("joinRoom", {
      roomId: normalizedRoomId,
      playerName: playerName.trim(),
      baseTime,
      increment,
    });
  }

  function handleJoinRoomAsSpectator(targetRoomId: string) {
    if (!authToken && !guestMode) {
      setStatusMessage("Please log in first to spectate a match.");
      return;
    }
    if (!playerName.trim()) {
      setStatusMessage("Enter your player name before joining as a spectator.");
      return;
    }
    const normalizedRoomId = targetRoomId.trim().toUpperCase();
    socketRef.current?.emit("joinRoom", {
      roomId: normalizedRoomId,
      playerName: playerName.trim(),
      baseTime,
      increment,
      spectator: true,
    });
  }

  function sendChat() {
    if (!chatInput.trim() || !roomId) return;
    const payload = { roomId, author: playerName || 'Guest', message: chatInput.trim() };
    socketRef.current?.emit('chatMessage', payload);
    setChatInput("");
  }

  function handleCreateMatch() {
    if (!authToken && !guestMode) {
      setStatusMessage("Please log in first to create a match.");
      return;
    }
    if (!playerName.trim()) {
      setStatusMessage("Enter your player name before creating a match.");
      return;
    }

    const newRoomId = createRoomId();
    setJoinRoomId(newRoomId);
    handleJoinRoom(newRoomId);
    // optimistic refresh
    fetchRooms().catch(() => {});
  }

  function handleLeaveMatch() {
    if (!roomId) {
      return;
    }

    socketRef.current?.emit("leaveRoom", { roomId });
    setJoined(false);
    setRoomId("");
    setPlayerColor(null);
    setMatchStatus("waiting");
    setFen("start");
    setMoveHistory([]);
    setCurrentTurn("w");
    setWhiteName("White");
    setBlackName("Black");
    setWhiteTime(baseTime);
    setBlackTime(baseTime);
    setResultText(null);
    setStatusMessage("You left the match. Create or join another room.");
  }

  async function fetchRooms() {
    try {
      const res = await fetch(`${serverUrl}/rooms`);
      if (!res.ok) return;
      const data = await res.json();
      setRoomsList(data || []);
    } catch (e) {
      // ignore
    }
  }

  async function fetchPlayerHistory(token?: string) {
    const activeToken = token || authToken;
    if (!activeToken) {
      setPlayerHistory([]);
      return;
    }

    try {
      const res = await fetch(`${serverUrl}/player/history`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (!res.ok) {
        setPlayerHistory([]);
        return;
      }
      const data = await res.json();
      setPlayerHistory(data || []);
    } catch (e) {
      setPlayerHistory([]);
    }
  }

  function parseSeedValues() {
    return seedValues.split("\n").reduce((acc: Record<string, number>, line) => {
      const [name, value] = line.split(":").map((part) => part.trim());
      if (name) {
        acc[name] = Number(value) || 0;
      }
      return acc;
    }, {});
  }

  async function handleLogin() {
    try {
      const res = await fetch(`${serverUrl || ""}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Login failed");
      setAuthToken(data.token);
      setAuthUsername(data.username);
      setAuthRole(data.role);
      setPlayerName(data.username);
      localStorage.setItem("chessToken", data.token);
      localStorage.setItem("chessUsername", data.username);
      localStorage.setItem("chessRole", data.role);
      setStatusMessage(`Logged in as ${data.username}`);
      setLoginPassword("");
      await fetchPlayerHistory(data.token);
    } catch (error: any) {
      setStatusMessage(error.message || "Login failed");
    }
  }

  async function handleRegister() {
    try {
      const res = await fetch(`${serverUrl || ""}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: registerUsername.trim(), password: registerPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Registration failed");
      setAuthToken(data.token);
      setAuthUsername(data.username);
      setAuthRole(data.role);
      setPlayerName(data.username);
      localStorage.setItem("chessToken", data.token);
      localStorage.setItem("chessUsername", data.username);
      localStorage.setItem("chessRole", data.role);
      setStatusMessage(`Registered and logged in as ${data.username}`);
      setRegisterPassword("");
      setRegisterUsername("");
      await fetchPlayerHistory(data.token);
    } catch (error: any) {
      setStatusMessage(error.message || "Registration failed");
    }
  }

  function handleLogout() {
    setAuthToken(null);
    setAuthUsername("");
    setAuthRole(null);
    setGuestMode(false);
    setPlayerHistory([]);
    localStorage.removeItem("chessToken");
    localStorage.removeItem("chessUsername");
    localStorage.removeItem("chessRole");
    setStatusMessage("Logged out.");
  }

  function handleGuestAccess() {
    setGuestMode(true);
    setAuthUsername("Guest");
    setAuthRole("guest");
    setPlayerName("Guest");
    setStatusMessage("Guest access enabled. Join a match or spectate a game.");
  }

  function handleReconnectToLastRoom() {
    if (!socketRef.current) return;
    socketRef.current.emit("reconnectLastRoom");
  }

  async function loadAdminDashboard() {
    if (!authToken) {
      setStatusMessage("Admin login required.");
      return;
    }
    try {
      const res = await fetch(`${serverUrl || ""}/organizer/dashboard`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load dashboard");
      setDashboardRooms(data.rooms || []);
      setDashboardResults(data.results || []);
      setStatusMessage("Loaded admin dashboard.");
    } catch (error: any) {
      setStatusMessage(error.message || "Failed to load dashboard");
    }
  }

  function handleTimeSelection(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = Number(event.target.value);
    setBaseTime(value);
  }

  function handleIncrementSelection(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = Number(event.target.value);
    setIncrement(value);
  }

  function handleMove(sourceSquare: string, targetSquare: string) {
    if (!joined || matchStatus !== "playing" || !playerColor) {
      return false;
    }

    const colorTurn = currentTurn === "w" ? "white" : "black";
    if (colorTurn !== playerColor) {
      return false;
    }

    socketRef.current?.emit("makeMove", {
      roomId,
      from: sourceSquare,
      to: targetSquare,
      promotion: "q",
    });

    return false;
  }

  function copyRoomCode() {
    if (!roomId) return;
    try {
      navigator.clipboard.writeText(roomId);
      setStatusMessage("Room code copied to clipboard.");
    } catch {
      setStatusMessage("Unable to copy room code.");
    }
  }

  function downloadMoveHistory() {
    const lines = moveHistory.length > 0
      ? [
          `Room: ${roomId}`,
          `White: ${whiteName}`,
          `Black: ${blackName}`,
          "",
          "Move History",
          "White | Black",
          ...moveHistoryLines,
        ]
      : ["No moves yet"];

    const content = lines.join("\r\n");
    const blob = new Blob(["\uFEFF", content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `move-history-${roomId || "match"}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleResign() {
    if (!roomId || !joined || !playerColor || !socketRef.current) {
      return;
    }
    socketRef.current.emit("resign", { roomId });
  }

  const isMyTurn = playerColor === "white" ? currentTurn === "w" : currentTurn === "b";

  if (!isLoggedIn) {
    return (
      <div className="auth-page">
        <div className="auth-page-inner">
          <section className="auth-left">
            <div className="auth-logo">
              <svg className="custom-night-icon" width="40" height="40" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e"></stop>
                    <stop offset="100%" stopColor="#16a34a"></stop>
                  </linearGradient>
                </defs>
                <rect width="512" height="512" rx="80" fill="#0b0f14"></rect>
                <path d="M330 90 C280 70 220 90 205 140 C195 170 210 195 235 210 L210 250 C190 280 185 320 200 355 L185 400 L335 400 L320 355 C335 320 330 280 310 250 L285 215 C320 205 345 180 345 145 C345 125 340 105 330 90 Z" fill="url(#g)"></path>
                <circle cx="255" cy="145" r="10" fill="#0b0f14"></circle>
                <rect x="170" y="420" width="172" height="24" rx="12" fill="url(#g)"></rect>
              </svg>
              <span>ONECHESS</span>
            </div>

            <div className="auth-hero-copy">
              <h1>
                Play. <span className="auth-highlight">Learn.</span><br />
                Win.
              </h1>
              <p>Join thousands of players around the world and enjoy the game of kings.</p>
            </div>

            <div className="auth-feature-list">
              <div className="feature-item">
                <div className="feature-icon">
                  <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M12 11a3 3 0 100-6 3 3 0 000 6z" fill="currentColor"/>
                    <path d="M4 20a8 8 0 0116 0v1H4v-1z" fill="currentColor"/>
                  </svg>
                </div>
                <div>
                  <strong>Play Online</strong>
                  <span>Challenge players worldwide</span>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon">
                  <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="3" y="10" width="4" height="11" fill="currentColor" rx="1"/>
                    <rect x="10" y="6" width="4" height="15" fill="currentColor" rx="1"/>
                    <rect x="17" y="3" width="4" height="18" fill="currentColor" rx="1"/>
                  </svg>
                </div>
                <div>
                  <strong>Improve Rating</strong>
                  <span>Climb the leaderboard</span>
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon">
                  <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3z" fill="currentColor"/>
                    <path d="M11 14v5h2v-5h-2z" fill="currentColor"/>
                  </svg>
                </div>
                <div>
                  <strong>Learn & Analyze</strong>
                  <span>Study games and puzzles</span>
                </div>
              </div>
            </div>

            <div className="auth-stats">
              <div className="stat-card">
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M12 12a3 3 0 100-6 3 3 0 000 6z" fill="currentColor"/>
                    <path d="M4 20a8 8 0 0116 0v1H4v-1z" fill="currentColor"/>
                  </svg>
                </div>
                <strong>50K+</strong>
                <span>Players</span>
              </div>
              <div className="stat-card">
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="4" y="8" width="4" height="10" rx="1" fill="currentColor"/>
                    <rect x="10" y="6" width="4" height="12" rx="1" fill="currentColor"/>
                    <rect x="16" y="4" width="4" height="14" rx="1" fill="currentColor"/>
                  </svg>
                </div>
                <strong>10K+</strong>
                <span>Games Today</span>
              </div>
              <div className="stat-card">
                <div className="stat-icon">
                  <svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M5 4h14v3a4 4 0 01-4 4H9a4 4 0 01-4-4V4z" fill="currentColor"/>
                    <path d="M7 14h10v2a3 3 0 01-3 3H10a3 3 0 01-3-3v-2z" fill="currentColor"/>
                  </svg>
                </div>
                <strong>2K+</strong>
                <span>Tournaments</span>
              </div>
            </div>

            <div className="auth-quote">
              “Chess is the gymnasium of the mind.”
              <span className="auth-quote-author">– Blaise Pascal</span>
            </div>
          </section>

          <section className="auth-right">
            <div className="auth-right-card">
            <div className="auth-tabs">
              <button className={`auth-tab ${authMode === "login" ? "active" : ""}`} onClick={() => setAuthMode("login")}>
                Login
              </button>
              <button className={`auth-tab ${authMode === "signup" ? "active" : ""}`} onClick={() => setAuthMode("signup")}>
                Sign Up
              </button>
            </div>

            <div className="auth-welcome">
              <div className="welcome-icon">♞</div>
              <div>
                <h2>{authMode === "login" ? "Welcome Back!" : "Create your account"}</h2>
                <p>{authMode === "login" ? "Login to continue your chess journey" : "Start playing and competing instantly"}</p>
              </div>
            </div>

            <div className="auth-social-group">
              <button className="auth-social-button google" type="button">
                <span className="social-icon">
                  <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="2" y="2" width="8" height="8" rx="2" fill="#4285F4"/>
                    <rect x="14" y="2" width="8" height="8" rx="2" fill="#DB4437"/>
                    <rect x="2" y="14" width="8" height="8" rx="2" fill="#0F9D58"/>
                    <rect x="14" y="14" width="8" height="8" rx="2" fill="#F4B400"/>
                  </svg>
                </span>
                Continue with Google
              </button>
              <button className="auth-social-button facebook" type="button">
                <span className="social-icon">
                  <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="0" y="0" width="24" height="24" rx="4" fill="#1877F2"/>
                    <path d="M15.5 8.5h-1.2c-.3 0-.8.2-.8.9v1.1h2l-.3 2.1h-1.7V20h-2.1v-7.4H9.8v-2.1h1.7V9.6c0-1.7 1-2.8 2.6-2.8.8 0 1.6.1 1.8.1v2.6z" fill="#fff"/>
                  </svg>
                </span>
                Continue with Facebook
              </button>
            </div>

            <div className="auth-divider">or continue with email</div>

            <div className="auth-form">
              <label className="auth-field">
                <span>Email address</span>
                <input
                  type="email"
                  value={authMode === "login" ? loginUsername : registerUsername}
                  onChange={(event) =>
                    authMode === "login"
                      ? setLoginUsername(event.target.value)
                      : setRegisterUsername(event.target.value)
                  }
                  placeholder="name@example.com"
                />
              </label>
              <label className="auth-field">
                <span>Password</span>
                <input
                  type="password"
                  value={authMode === "login" ? loginPassword : registerPassword}
                  onChange={(event) =>
                    authMode === "login"
                      ? setLoginPassword(event.target.value)
                      : setRegisterPassword(event.target.value)
                  }
                  placeholder="Enter your password"
                />
              </label>
              <div className="auth-forgot">Forgot password?</div>
            </div>

            <div className="auth-action">
              <button
                className="auth-submit-button"
                type="button"
                onClick={authMode === "login" ? handleLogin : handleRegister}
              >
                {authMode === "login" ? "Login" : "Create account"}
              </button>
              <button className="auth-guest-button" type="button" onClick={handleGuestAccess}>
                Play as Guest
              </button>
            </div>

            <div className="auth-footer">
              {authMode === "login" ? (
                <>
                  Don't have an account?{' '}
                  <button type="button" onClick={() => setAuthMode("signup")}>
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button type="button" onClick={() => setAuthMode("login")}>
                    Login
                  </button>
                </>
              )}
            </div>

            <div className="auth-status">{statusMessage}</div>
          </div>
          </section>
        </div>
      </div>
    );
  }

  // Dashboard View
  if (!joined) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#0f1419", color: "white" }}>
        {/* Dashboard Header */}
        <div style={{ borderBottom: "1px solid rgba(34, 197, 94, 0.15)", padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(0, 0, 0, 0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "1.4rem", fontWeight: 700 }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: "linear-gradient(135deg, #10b981 0%, #22c55e 100%)", display: "flex", alignItems: "center", justifyContent: "center", color: "#0b0f14", fontSize: "1.2rem" }}>♞</div>
            <span>ONECHESS</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8h-1V7c0-.6-.4-1-1-1H8c-.6 0-1 .4-1 1v1H6c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1h12c.6 0 1-.4 1-1V9c0-.6-.4-1-1-1zm-3 6H9v-1h6v1z" fill="currentColor"></path>
            </svg>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="currentColor"></path>
            </svg>
            <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "linear-gradient(135deg, #22c55e 0%, #10b981 100%)", display: "flex", alignItems: "center", justifyContent: "center", color: "#0b0f14", fontWeight: 700, fontSize: "1rem" }}>
              {loginUsername.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontWeight: 600 }}>{loginUsername}</span>
          </div>
        </div>

        {/* Dashboard Content */}
        <div style={{ padding: "32px 32px", maxWidth: "1400px", margin: "0 auto" }}>
          {/* Welcome Section */}
          <div style={{ marginBottom: "48px" }}>
            <h1 style={{ margin: "0 0 12px 0", fontSize: "3.2rem", lineHeight: 1.1 }}>Welcome back,<br/><span style={{ color: "#22c55e" }}>{loginUsername}!</span></h1>
            <p style={{ color: "#9ca3af", margin: "0", fontSize: "1.05rem" }}>What will you play today?</p>
          </div>

          {/* Main Grid Layout */}
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "40px", alignItems: "start", marginBottom: "48px" }}>
            {/* Left Side - Action Cards 2x2 Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px" }}>
              {[
                { title: "Play Online", desc: "Play with players around the world", icon: "👥", highlight: true },
                { title: "Create Room", desc: "Create a room and invite your friends", icon: "🏆", highlight: false },
                { title: "Join Room", desc: "Join a room using room ID", icon: "🎮", highlight: false },
                { title: "Tournaments", desc: "Compete in exciting tournaments", icon: "🏰", highlight: false },
              ].map((action, idx) => (
                <div key={idx} style={{
                  padding: "22px",
                  borderRadius: "12px",
                  border: action.highlight ? "2px solid #22c55e" : "1px solid rgba(255, 255, 255, 0.08)",
                  backgroundColor: action.highlight ? "rgba(34, 197, 94, 0.08)" : "rgba(0, 0, 0, 0.3)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  transition: "all 0.3s ease",
                }}>
                  <div style={{ fontSize: "2.4rem" }}>{action.icon}</div>
                  <div>
                    <h3 style={{ margin: "0 0 4px 0", color: action.highlight ? "#22c55e" : "white", fontWeight: 600, fontSize: "1rem" }}>{action.title}</h3>
                    <p style={{ margin: 0, color: "#9ca3af", fontSize: "0.85rem", lineHeight: 1.4 }}>{action.desc}</p>
                  </div>
                  <div style={{ color: "#22c55e", fontSize: "1.2rem", marginTop: "4px" }}>›</div>
                </div>
              ))}
            </div>

            {/* Right Side - Chess Image & Stats */}
            <div style={{ display: "grid", gap: "20px" }}>
              {/* Chess Piece Visualization */}
              <div style={{
                height: "280px",
                backgroundColor: "rgba(34, 197, 94, 0.05)",
                borderRadius: "12px",
                border: "1px solid rgba(34, 197, 94, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "5.5rem",
                position: "relative",
                overflow: "hidden",
              }}>
                <div style={{ textShadow: "0 0 30px rgba(34, 197, 94, 0.6)", animation: "glow 2s ease-in-out infinite" }}>♛</div>
              </div>

              {/* Stats Grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: "12px",
                backgroundColor: "rgba(0, 0, 0, 0.3)",
                padding: "20px",
                borderRadius: "12px",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}>
                {[
                  { emoji: "⭐", value: "1450", label: "Rating", color: "#22c55e" },
                  { emoji: "🎮", value: "500", label: "Games", color: "#9ca3af" },
                  { emoji: "📈", value: "280", label: "Wins", color: "#22c55e" },
                  { emoji: "📉", value: "180", label: "Losses", color: "#ef4444" },
                  { emoji: "🤝", value: "40", label: "Draws", color: "#fbbf24" },
                ].map((stat, idx) => (
                  <div key={idx} style={{ textAlign: "center", padding: "8px" }}>
                    <div style={{ fontSize: "1.5rem", marginBottom: "6px" }}>{stat.emoji}</div>
                    <div style={{ color: stat.color, fontSize: "1.3rem", fontWeight: 700, marginBottom: "2px" }}>{stat.value}</div>
                    <div style={{ color: "#9ca3af", fontSize: "0.75rem", fontWeight: 500 }}>{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent Matches */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
              <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Recent Matches</h2>
              <a href="#" style={{ color: "#22c55e", textDecoration: "none", fontSize: "0.9rem", fontWeight: 500 }}>View All</a>
            </div>
            <div style={{ backgroundColor: "rgba(0, 0, 0, 0.2)", borderRadius: "12px", border: "1px solid rgba(255, 255, 255, 0.08)", overflow: "hidden" }}>
              {[
                { id: 1, opponent: "Player123", result: "Win", color: "#22c55e" },
                { id: 2, opponent: "Player456", result: "Loss", color: "#ef4444" },
                { id: 3, opponent: "Player789", result: "Draw", color: "#9ca3af" },
              ].map((match, idx) => (
                <div key={idx} style={{
                  display: "grid",
                  gridTemplateColumns: "50px 1fr 80px 1fr 100px",
                  gap: "18px",
                  alignItems: "center",
                  padding: "16px 22px",
                  borderBottom: idx < 2 ? "1px solid rgba(255, 255, 255, 0.05)" : "none",
                }}>
                  <div style={{ color: "#9ca3af", fontWeight: 600, fontSize: "0.95rem" }}>{match.id}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "50%", backgroundColor: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center", color: "#0b0f14", fontSize: "0.85rem", fontWeight: 700 }}>Y</div>
                    <span style={{ fontSize: "0.95rem" }}>You</span>
                  </div>
                  <div style={{ textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>vs</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "50%", backgroundColor: "#9ca3af", display: "flex", alignItems: "center", justifyContent: "center", color: "#0b0f14", fontSize: "0.85rem", fontWeight: 700 }}>P</div>
                    <span style={{ fontSize: "0.95rem" }}>{match.opponent}</span>
                  </div>
                  <div style={{ textAlign: "right", color: match.color, fontWeight: 600, fontSize: "0.95rem" }}>{match.result}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Game Board View
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        minHeight: "100vh",
        backgroundColor: "#111111",
        color: "white",
        gap: "30px",
        padding: "30px",
      }}
    >
      <div style={{ flex: "0 0 760px", display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              backgroundColor: connected ? "#34d399" : "#f97316",
            }}
          />
          <span>{connected ? "Server connected" : "Server disconnected"}</span>
        </div>

        <div
          style={{
            backgroundColor: "#1f2937",
            borderRadius: "16px",
            padding: "18px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          }}
        >
          {joined ? (
            <Chessboard
              position={fen}
              boardWidth={720}
              onPieceDrop={handleMove}
              customBoardStyle={{
                borderRadius: "15px",
                boxShadow: "0 20px 40px rgba(0, 0, 0, 0.35)",
              }}
              customLightSquareStyle={{ backgroundColor: "#f0d9b5" }}
              customDarkSquareStyle={{ backgroundColor: "#b58863" }}
              arePiecesDraggable={joined && matchStatus === "playing" && isMyTurn}
            />
          ) : (
            <div style={{ display: "grid", gap: "16px" }}>
              <h2 style={{ marginTop: 0, marginBottom: "0" }}>Ready to play</h2>
              <p style={{ color: "#cbd5e1", margin: 0 }}>
                Log in, create a match, or join an active room to start playing.
              </p>

            </div>
          )}
        </div>

        {!joined && (
          <div
            style={{
              backgroundColor: "#1f2937",
              borderRadius: "16px",
              padding: "18px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: "18px" }}>Match setup</h2>
            <div style={{ display: "grid", gap: "14px" }}>
              {!isLoggedIn ? (
                <div style={{ display: "grid", gap: "12px", padding: "14px", borderRadius: "14px", backgroundColor: "#111827" }}>
                  <div style={{ fontWeight: 600 }}>Login or register</div>
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div style={{ display: "grid", gap: "8px" }}>
                      <label style={{ display: "grid", gap: "6px" }}>
                        Username
                        <input
                          value={loginUsername}
                          onChange={(event) => setLoginUsername(event.target.value)}
                          placeholder="Username"
                          style={{ width: "100%", padding: "10px", borderRadius: "10px", border: "1px solid #374151", backgroundColor: "#0f172a", color: "white" }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: "6px" }}>
                        Password
                        <input
                          type="password"
                          value={loginPassword}
                          onChange={(event) => setLoginPassword(event.target.value)}
                          placeholder="Password"
                          style={{ width: "100%", padding: "10px", borderRadius: "10px", border: "1px solid #374151", backgroundColor: "#0f172a", color: "white" }}
                        />
                      </label>
                      <button onClick={handleLogin} style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "none", backgroundColor: "#2563eb", color: "white", cursor: "pointer" }}>
                        Login
                      </button>
                    </div>
                    <div style={{ display: "grid", gap: "8px" }}>
                      <label style={{ display: "grid", gap: "6px" }}>
                        New account
                        <input
                          value={registerUsername}
                          onChange={(event) => setRegisterUsername(event.target.value)}
                          placeholder="Username"
                          style={{ width: "100%", padding: "10px", borderRadius: "10px", border: "1px solid #374151", backgroundColor: "#0f172a", color: "white" }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: "6px" }}>
                        Password
                        <input
                          type="password"
                          value={registerPassword}
                          onChange={(event) => setRegisterPassword(event.target.value)}
                          placeholder="Password"
                          style={{ width: "100%", padding: "10px", borderRadius: "10px", border: "1px solid #374151", backgroundColor: "#0f172a", color: "white" }}
                        />
                      </label>
                      <button onClick={handleRegister} style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "none", backgroundColor: "#10b981", color: "white", cursor: "pointer" }}>
                        Register
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              {isPlayer ? (
                <div style={{ display: "grid", gap: "12px" }}>
                  <label style={{ display: "grid", gap: "8px" }}>
                    Your name
                    <input
                      value={authUsername || playerName}
                      onChange={(event) => setPlayerName(event.target.value)}
                      placeholder="Enter your name"
                      disabled={!!authToken && authRole === "player"}
                      style={{
                        width: "100%",
                        padding: "12px",
                        borderRadius: "10px",
                        border: "1px solid #374151",
                        backgroundColor: authToken && authRole === "player" ? "#1f2937" : "#111827",
                        color: "white",
                      }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: "8px" }}>
                    Match ID
                    <input
                      value={joinRoomId}
                      onChange={(event) => setJoinRoomId(event.target.value)}
                      placeholder="Enter or create an ID"
                      style={{
                        width: "100%",
                        padding: "12px",
                        borderRadius: "10px",
                        border: "1px solid #374151",
                        backgroundColor: "#111827",
                        color: "white",
                      }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: "8px" }}>
                    Starting time
                    <select
                      value={baseTime}
                      onChange={handleTimeSelection}
                      style={{
                        width: "100%",
                        padding: "12px",
                        borderRadius: "10px",
                        border: "1px solid #374151",
                        backgroundColor: "#111827",
                        color: "white",
                      }}
                    >
                      <option value={60}>1 min</option>
                      <option value={180}>3 min</option>
                      <option value={300}>5 min</option>
                      <option value={600}>10 min</option>
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: "8px" }}>
                    Increment per move
                    <select
                      value={increment}
                      onChange={handleIncrementSelection}
                      style={{
                        width: "100%",
                        padding: "12px",
                        borderRadius: "10px",
                        border: "1px solid #374151",
                        backgroundColor: "#111827",
                        color: "white",
                      }}
                    >
                      <option value={0}>0 sec</option>
                      <option value={1}>1 sec</option>
                      <option value={2}>2 sec</option>
                      <option value={3}>3 sec</option>
                      <option value={5}>5 sec</option>
                    </select>
                  </label>

                  <div style={{ display: "flex", gap: "12px" }}>
                    <button
                      onClick={handleCreateMatch}
                      style={{
                        flex: 1,
                        padding: "14px",
                        borderRadius: "10px",
                        border: "none",
                        backgroundColor: "#2563eb",
                        cursor: "pointer",
                      }}
                    >
                      Create match
                    </button>
                    <button
                      onClick={() => handleJoinRoom(joinRoomId)}
                      style={{
                        flex: 1,
                        padding: "14px",
                        borderRadius: "10px",
                        border: "none",
                        backgroundColor: "#10b981",
                        cursor: "pointer",
                      }}
                    >
                      Join match
                    </button>
                  </div>
                </div>
              ) : !isLoggedIn ? (
                <div style={{ padding: "18px", borderRadius: "16px", backgroundColor: "#111827" }}>
                  <div style={{ color: "#cbd5e1" }}>Log in to create or join matches and view your past games.</div>
                </div>
              ) : (
                <div style={{ padding: "18px", borderRadius: "16px", backgroundColor: "#111827" }}>
                  <div style={{ color: "#cbd5e1" }}>Admin users manage tournaments here and do not join player matches.</div>
                </div>
              )}

              {authToken ? (
              <div style={{ marginTop: 6 }}>
                <strong style={{ display: "block", marginBottom: 8 }}>Active matches</strong>
                <div style={{ display: "grid", gap: 8 }}>
                  {roomsList.length === 0 ? (
                    <div style={{ color: "#9ca3af" }}>No active matches.</div>
                  ) : (
                    roomsList.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "8px",
                          borderRadius: "8px",
                          backgroundColor: "#0f172a",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600 }}>{r.id}</div>
                          <div style={{ color: "#9ca3af", fontSize: 12 }}>{r.status} • {r.whiteName || 'Waiting' } vs {r.blackName || 'Waiting'}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => { setJoinRoomId(r.id); handleJoinRoom(r.id); }}
                            style={{ padding: "8px 10px", borderRadius: 8, border: "none", backgroundColor: "#10b981", color: "white", cursor: "pointer" }}
                          >
                            Join
                          </button>
                          <button
                            onClick={() => handleJoinRoomAsSpectator(r.id)}
                            style={{ padding: "8px 10px", borderRadius: 8, border: "none", backgroundColor: "#6b7280", color: "white", cursor: "pointer" }}
                          >
                            Spectate
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => fetchRooms()} style={{ padding: "8px 10px", borderRadius: 8, border: "none", backgroundColor: "#2563eb", color: "white" }}>Refresh</button>
                </div>
              </div>
              ) : null}

              <div style={{ marginTop: "8px", color: "#cbd5e1", minHeight: "24px" }}>{statusMessage}</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: "0 0 420px", display: "grid", gap: "24px" }}>
        <div
          style={{
            backgroundColor: "transparent",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "none",
          }}
        >
          
          {joined ? (
            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "grid", gap: "12px", padding: "16px", borderRadius: "14px", backgroundColor: "transparent" }}>
                <div style={{ fontWeight: 600 }}>Players</div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>White</div>
                    <div>{whiteName || "Waiting"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>Black</div>
                    <div>{blackName || "Waiting"}</div>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: "12px" }}>
                <div style={{ padding: "12px", borderRadius: "14px", backgroundColor: "transparent" }}>
                  <div style={{ color: "#9ca3af", marginBottom: "6px" }}>Match status</div>
                  <div>{matchStatus === "waiting" ? "Waiting for opponent" : matchStatus === "playing" ? isMyTurn ? "Your turn" : "Opponent's turn" : `Finished: ${resultText || "Game over"}`}</div>
                </div>
                <div style={{ padding: "12px", borderRadius: "14px", backgroundColor: "transparent" }}>
                  <div style={{ color: "#9ca3af", marginBottom: "6px" }}>Increment</div>
                  <div>{increment} sec</div>
                </div>
                <div style={{ display: "flex", gap: "12px" }}>
                  <div style={{ flex: 1, padding: "12px", borderRadius: "14px", backgroundColor: "transparent" }}>
                    <div style={{ color: "#9ca3af", marginBottom: "6px" }}>White clock</div>
                    <div style={{ fontSize: "22px" }}>{formatTime(whiteTime)}</div>
                  </div>
                  <div style={{ flex: 1, padding: "12px", borderRadius: "14px", backgroundColor: "#111827" }}>
                    <div style={{ color: "#9ca3af", marginBottom: "6px" }}>Black clock</div>
                    <div style={{ fontSize: "22px" }}>{formatTime(blackTime)}</div>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "12px" }}>
                {playerColor !== "spectator" && matchStatus === "playing" ? (
                  <button onClick={handleResign} style={{ flex: 1, padding: "14px", borderRadius: "12px", border: "none", backgroundColor: "#f97316", color: "white", cursor: "pointer" }}>
                    Resign
                  </button>
                ) : null}
                <button onClick={handleLeaveMatch} style={{ flex: 1, padding: "14px", borderRadius: "12px", border: "none", backgroundColor: "#ef4444", color: "white", cursor: "pointer" }}>
                  Leave match
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "12px" }}>
              {authToken ? (
                <div style={{ padding: "14px", borderRadius: "14px", backgroundColor: "transparent" }}>
                  <button onClick={handleLogout} style={{ padding: "10px 12px", borderRadius: 8, border: "none", backgroundColor: "#ef4444", color: "white", cursor: "pointer" }}>Logout</button>
                </div>
              ) : (
                <div style={{ padding: "14px", borderRadius: "14px", backgroundColor: "transparent", color: "#cbd5e1" }}>Not logged in</div>
              )}
            </div>
          )}
        </div>

        {joined ? (
          <div
            style={{
              backgroundColor: "transparent",
              borderRadius: "16px",
              padding: "24px",
              boxShadow: "none",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
              <h2 style={{ margin: 0 }}>Move history</h2>
              <button onClick={downloadMoveHistory} style={{ padding: "10px 14px", borderRadius: "12px", border: "none", backgroundColor: "#2563eb", color: "white", cursor: "pointer" }}>
                Download
              </button>
            </div>
            <div style={{ display: "grid", gap: "10px", maxHeight: "460px", overflow: "auto" }}>
              {moveHistoryLines.length === 0 ? (
                <div style={{ color: "#9ca3af" }}>No moves have been played yet.</div>
              ) : (
                moveHistoryLines.map((line, idx) => (
                  <div key={idx} style={{ padding: "12px", borderRadius: "12px", backgroundColor: "transparent", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" }}>
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default App;
