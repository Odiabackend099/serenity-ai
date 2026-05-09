import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const navy = "#02081f";
const navy2 = "#071238";
const gold = "#e7b416";
const gold2 = "#f7cf4d";
const ink = "#111827";
const muted = "#667085";
const green = "#16a34a";
const red = "#dc2626";

const sceneStarts = {
  intro: 0,
  discovery: 180,
  whatsapp: 540,
  notifications: 1110,
  dashboard: 1470,
  operations: 1830,
  emergency: 2250,
  close: 2640,
};

const sceneVoiceovers = [
  { from: sceneStarts.intro, durationInFrames: 180, src: "assets/audio/voiceover/01-intro.mp3" },
  { from: sceneStarts.discovery, durationInFrames: 360, src: "assets/audio/voiceover/02-discovery.mp3" },
  { from: sceneStarts.whatsapp, durationInFrames: 570, src: "assets/audio/voiceover/03-whatsapp.mp3" },
  { from: sceneStarts.notifications, durationInFrames: 360, src: "assets/audio/voiceover/04-notifications.mp3" },
  { from: sceneStarts.dashboard, durationInFrames: 360, src: "assets/audio/voiceover/05-dashboard.mp3" },
  { from: sceneStarts.operations, durationInFrames: 420, src: "assets/audio/voiceover/06-operations.mp3" },
  { from: sceneStarts.emergency, durationInFrames: 390, src: "assets/audio/voiceover/07-emergency.mp3" },
  { from: sceneStarts.close, durationInFrames: 360, src: "assets/audio/voiceover/08-close.mp3" },
];

export const SerenityDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: navy, fontFamily: "Inter, Arial, sans-serif" }}>
      <BackgroundMusic />
      {sceneVoiceovers.map((voiceover) => (
        <Sequence
          key={voiceover.src}
          from={voiceover.from}
          durationInFrames={voiceover.durationInFrames}
        >
          <Audio src={staticFile(voiceover.src)} volume={0.94} />
        </Sequence>
      ))}
      <Sequence from={sceneStarts.intro} durationInFrames={180}>
        <IntroScene />
      </Sequence>
      <Sequence from={sceneStarts.discovery} durationInFrames={360}>
        <DiscoveryScene />
      </Sequence>
      <Sequence from={sceneStarts.whatsapp} durationInFrames={570}>
        <WhatsAppScene />
      </Sequence>
      <Sequence from={sceneStarts.notifications} durationInFrames={360}>
        <NotificationScene />
      </Sequence>
      <Sequence from={sceneStarts.dashboard} durationInFrames={360}>
        <DashboardScene />
      </Sequence>
      <Sequence from={sceneStarts.operations} durationInFrames={420}>
        <OperationsScene />
      </Sequence>
      <Sequence from={sceneStarts.emergency} durationInFrames={390}>
        <EmergencyScene />
      </Sequence>
      <Sequence from={sceneStarts.close} durationInFrames={360}>
        <ClosingScene />
      </Sequence>
    </AbsoluteFill>
  );
};

const BackgroundMusic: React.FC = () => {
  const frame = useCurrentFrame();
  const volume = interpolate(frame, [0, 100, 2520, 2820, 3000], [0, 0.72, 0.68, 0.82, 0], clamp);

  return <Audio src={staticFile("assets/audio/music/serenity-background.mp3")} volume={volume} />;
};

const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const logoScale = springIn(frame, 0, 45, 0.86, 1);
  const line = fade(frame, 45, 40);
  const badges = [
    "WhatsApp AI",
    "Appointment booking",
    "Staff alerts",
    "Emergency escalation",
  ];

  return (
    <SceneShell>
      <BrandWatermark />
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", gap: 62 }}>
        <div style={{ opacity: fade(frame, 8, 34), transform: `translateY(${interpolate(frame, [0, 45], [26, 0], clamp)}px)` }}>
          <LogoCard size={164} />
        </div>
        <div style={{ maxWidth: 980 }}>
          <p style={eyebrow(gold)}>SERENITY ROYALE HOSPITAL AI</p>
          <h1 style={{ margin: "18px 0 16px", fontSize: 86, lineHeight: 0.96, color: "white", letterSpacing: 0, transform: `scale(${logoScale})`, transformOrigin: "left center" }}>
            The patient journey, handled after hours.
          </h1>
          <p style={{ margin: 0, opacity: line, fontSize: 30, lineHeight: 1.35, color: "#d8e2f7", maxWidth: 840 }}>
            From first WhatsApp message to booked appointment, staff notification, dashboard review, and urgent escalation.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 34 }}>
            {badges.map((badge, index) => (
              <Pill key={badge} delay={80 + index * 12}>
                {badge}
              </Pill>
            ))}
          </div>
        </div>
      </div>
    </SceneShell>
  );
};

const DiscoveryScene: React.FC = () => {
  const frame = useCurrentFrame();
  const websiteProgress = interpolate(frame, [120, 190], [0, 1], clamp);

  return (
    <SceneShell>
      <SceneTitle
        eyebrowText="1. Discovery"
        title="A patient searches for help in Abuja."
        subtitle="The first action is simple: open the hospital website and tap WhatsApp."
      />
      <div style={{ display: "grid", gridTemplateColumns: "0.88fr 1.12fr", gap: 46, marginTop: 32, alignItems: "center" }}>
        <BrowserFrame style={{ transform: `translateX(${interpolate(frame, [0, 70], [-70, 0], clamp)}px)`, opacity: fade(frame, 5, 35) }}>
          <div style={{ padding: 30, background: "#fff", height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#374151", fontSize: 23 }}>
              <span style={{ fontSize: 28 }}>Google</span>
              <div style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: 999, padding: "12px 22px", boxShadow: "0 10px 30px rgba(17,24,39,0.08)" }}>
                rehabilitation centers in Abuja
              </div>
            </div>
            <SearchResult delay={50} title="Serenity Royale Hospital" body="Specialist care in Abuja for addiction, psychiatry, neurology, rehabilitation and consultation." />
            <SearchResult delay={75} title="Book an appointment by WhatsApp" body="Open 24/7 AI assistant. Human staff follow up during hospital operations." />
            <SearchResult delay={100} title="Karu and Galadimawa centers" body="Select your preferred center and doctor during booking." />
          </div>
        </BrowserFrame>

        <div style={{ opacity: fade(frame, 115, 35), transform: `translateY(${interpolate(frame, [110, 180], [50, 0], clamp)}px) scale(${0.96 + websiteProgress * 0.04})` }}>
          <WebsiteMock />
        </div>
      </div>
    </SceneShell>
  );
};

const WhatsAppScene: React.FC = () => {
  const frame = useCurrentFrame();
  const messages = [
    { who: "ai", at: 40, text: "Hi Austyn, you are welcome to Serenity Royale Hospital. I am here to help. Would you like to speak with someone or book an appointment?" },
    { who: "user", at: 110, text: "I need help with drug rehabilitation. Can I book an appointment?" },
    { who: "ai", at: 170, text: "Yes. I can help. What is your full name?" },
    { who: "user", at: 220, text: "Austyn Samuah" },
    { who: "ai", at: 270, text: "What area are you contacting us from?" },
    { who: "user", at: 315, text: "Lube, Abuja" },
    { who: "ai", at: 360, text: "Which doctor would you prefer?" },
    { who: "user", at: 405, text: "Dr Grace Ikeh, Galadimawa. Tomorrow morning." },
    { who: "ai", at: 460, text: "Your appointment request has been received. A doctor will follow up shortly." },
  ] as const;

  return (
    <SceneShell>
      <SceneTitle
        eyebrowText="2. WhatsApp booking"
        title="A calm conversation turns hesitation into a clear next step."
        subtitle="The AI uses structured booking prompts, so appointment capture still works when the hospital is closed."
      />
      <div style={{ display: "grid", gridTemplateColumns: "0.78fr 1.22fr", gap: 48, alignItems: "center", marginTop: 18 }}>
        <ImpactStack frame={frame} />
        <PhoneFrame>
          <div style={{ height: "100%", background: "#0b141a", display: "flex", flexDirection: "column" }}>
            <WhatsAppHeader />
            <div style={{ flex: 1, padding: "24px 20px", display: "flex", flexDirection: "column", gap: 10, overflow: "hidden" }}>
              {messages.map((message, index) => (
                <ChatBubble key={`${message.at}-${message.text}`} side={message.who} delay={message.at} index={index}>
                  {message.text}
                </ChatBubble>
              ))}
            </div>
          </div>
        </PhoneFrame>
      </div>
    </SceneShell>
  );
};

const NotificationScene: React.FC = () => {
  const frame = useCurrentFrame();
  const cards = [
    { title: "Patient", role: "Confirmation sent", body: "Appointment request received. A doctor will follow up shortly.", color: green, at: 20 },
    { title: "Secretary", role: "Action required", body: "Abdullahi reviews the request and confirms the appointment in the dashboard.", color: gold, at: 70 },
    { title: "Dr. K", role: "Clinical oversight", body: "Dr. Adekunle Adesina receives the booking summary for oversight.", color: "#38bdf8", at: 120 },
    { title: "Dr. Grace Ikeh", role: "Selected doctor", body: "The chosen doctor receives the appointment alert with patient and slot details.", color: "#a78bfa", at: 170 },
  ];

  return (
    <SceneShell>
      <SceneTitle
        eyebrowText="3. Automatic routing"
        title="Every right person receives the right message."
        subtitle="One patient booking becomes a coordinated hospital workflow."
      />
      <div style={{ marginTop: 26, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
        {cards.map((card) => (
          <NotificationCard key={card.title} {...card} />
        ))}
      </div>
      <div style={{ marginTop: 34, opacity: fade(frame, 220, 35), display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <MiniInbox title="Secretary WhatsApp alert" lines={["New Serenity AI appointment", "Patient: Austyn Samuah", "Doctor: Dr. Grace Ikeh", "Please review in dashboard"]} />
        <MiniInbox title="Doctor WhatsApp alert" lines={["A patient requested an appointment with you", "Service: Drug rehabilitation", "Center: Galadimawa", "Preferred time: Tomorrow morning"]} />
      </div>
    </SceneShell>
  );
};

const DashboardScene: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 280], [1.05, 1.0], clamp);
  const x = interpolate(frame, [0, 280], [-44, 0], clamp);

  return (
    <SceneShell>
      <SceneTitle
        eyebrowText="4. Live command center"
        title="The secretary sees what needs attention."
        subtitle="Pending AI bookings, message delivery, staff alerts, calendar review, and recent AI activity are visible in one place."
      />
      <div style={{ marginTop: 18, borderRadius: 28, overflow: "hidden", border: "1px solid rgba(255,255,255,0.18)", boxShadow: "0 40px 100px rgba(0,0,0,0.42)", transform: `translateX(${x}px) scale(${scale})`, transformOrigin: "center top" }}>
        <Img src={staticFile("screenshots/dashboard-home.png")} style={{ width: "100%", display: "block" }} />
      </div>
      <Callout x={1205} y={286} delay={90} label="Secretary alerts: sent" />
      <Callout x={1090} y={430} delay={130} label="Calendar review visible" />
      <Callout x={516} y={680} delay={170} label="Recent AI activity" />
    </SceneShell>
  );
};

const OperationsScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneShell>
      <SceneTitle
        eyebrowText="5. Staff confirmation"
        title="If no doctor is selected, staff can assign one."
        subtitle="The dashboard stays human-friendly: assign doctor, confirm, retry alerts, and keep every party informed."
      />
      <div style={{ marginTop: 30, display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 38, alignItems: "start" }}>
        <AppointmentOpsPanel frame={frame} />
        <div style={{ display: "grid", gap: 18 }}>
          <OutcomeCard delay={80} title="Calendar" value="Synced" tone="green" body="The appointment is saved and checked against the hospital calendar." />
          <OutcomeCard delay={120} title="Patient WhatsApp" value="Sent" tone="green" body="The patient gets a clear confirmation message." />
          <OutcomeCard delay={160} title="Secretary" value="Sent" tone="gold" body="Abdullahi gets the action-ready summary." />
          <OutcomeCard delay={200} title="Dr. K and doctor" value="Notified" tone="blue" body="Oversight and assigned doctor alerts are logged." />
        </div>
      </div>
    </SceneShell>
  );
};

const EmergencyScene: React.FC = () => {
  const frame = useCurrentFrame();
  const alerts = [
    { name: "Patient", text: "I feel like I might hurt myself tonight.", at: 60, side: "user" },
    { name: "AI", text: "I am sorry you are feeling this way. Please call Serenity now. I am alerting the care team.", at: 120, side: "ai" },
  ] as const;

  return (
    <SceneShell>
      <SceneTitle
        eyebrowText="6. Emergency escalation"
        title="The AI does not try to handle crisis alone."
        subtitle="Risk language triggers a safer, structured response and alerts Dr. K plus the secretary."
      />
      <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1.2fr", gap: 42, alignItems: "center", marginTop: 24 }}>
        <PhoneFrame compact>
          <div style={{ height: "100%", background: "#0b141a", display: "flex", flexDirection: "column" }}>
            <WhatsAppHeader urgent />
            <div style={{ flex: 1, padding: "28px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
              {alerts.map((message, index) => (
                <ChatBubble key={message.text} side={message.side} delay={message.at} index={index}>
                  {message.text}
                </ChatBubble>
              ))}
            </div>
          </div>
        </PhoneFrame>
        <EmergencyDashboard frame={frame} />
      </div>
    </SceneShell>
  );
};

const ClosingScene: React.FC = () => {
  const frame = useCurrentFrame();
  const cards = [
    ["Patient supported", "The patient gets an immediate path to care."],
    ["Revenue protected", "After-hours demand is captured, not lost."],
    ["Staff aligned", "Secretary, Dr. K, and the assigned doctor know what happened."],
  ];

  return (
    <SceneShell>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28, opacity: fade(frame, 5, 35) }}>
          <LogoCard size={118} />
          <div style={{ height: 88, width: 1, background: "rgba(255,255,255,0.22)" }} />
          <Img src={staticFile("assets/odiadev-ai.jpeg")} style={{ width: 118, height: 118, objectFit: "cover", borderRadius: 26, boxShadow: "0 18px 50px rgba(0,0,0,0.28)" }} />
        </div>
        <h2 style={{ margin: "36px 0 14px", color: "white", fontSize: 72, lineHeight: 1, maxWidth: 1180, opacity: fade(frame, 40, 35) }}>
          Serenity AI keeps the front door open.
        </h2>
        <p style={{ margin: 0, color: "#dbe7ff", fontSize: 28, lineHeight: 1.35, maxWidth: 1030, opacity: fade(frame, 70, 35) }}>
          A hospital-grade WhatsApp assistant for appointment capture, staff coordination, and urgent escalation.
        </p>
        <div style={{ marginTop: 44, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18, width: 1250 }}>
          {cards.map(([title, body], index) => (
            <div key={title} style={{ ...glassCard, opacity: fade(frame, 105 + index * 20, 28), transform: `translateY(${interpolate(frame, [105 + index * 20, 150 + index * 20], [28, 0], clamp)}px)` }}>
              <p style={{ margin: 0, color: gold2, fontWeight: 800, fontSize: 22 }}>{title}</p>
              <p style={{ margin: "10px 0 0", color: "#d6dded", lineHeight: 1.35, fontSize: 19 }}>{body}</p>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 48, color: "rgba(255,255,255,0.72)", fontSize: 20, opacity: fade(frame, 205, 40) }}>
          Powered by ODIADEV AI.
        </p>
      </div>
    </SceneShell>
  );
};

const SceneShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${navy} 0%, ${navy2} 48%, #0d1b2d 100%)`, padding: "70px 86px", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 75% 20%, rgba(231,180,22,0.16), transparent 28%), radial-gradient(circle at 0% 100%, rgba(22,163,74,0.12), transparent 26%)" }} />
      <div style={{ position: "relative", height: "100%" }}>{children}</div>
    </AbsoluteFill>
  );
};

const SceneTitle: React.FC<{ eyebrowText: string; title: string; subtitle: string }> = ({ eyebrowText, title, subtitle }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ opacity: fade(frame, 0, 30), transform: `translateY(${interpolate(frame, [0, 35], [22, 0], clamp)}px)` }}>
      <p style={eyebrow(gold)}>{eyebrowText}</p>
      <h2 style={{ margin: "12px 0 8px", color: "white", fontSize: 54, lineHeight: 1.02, letterSpacing: 0 }}>{title}</h2>
      <p style={{ margin: 0, color: "#cdd8ee", fontSize: 24, lineHeight: 1.35, maxWidth: 1280 }}>{subtitle}</p>
    </div>
  );
};

const LogoCard: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ width: size, height: size, borderRadius: Math.round(size * 0.19), background: navy, border: `2px solid rgba(231,180,22,0.55)`, display: "grid", placeItems: "center", boxShadow: "0 24px 70px rgba(0,0,0,0.34)" }}>
    <Img src={staticFile("assets/serenity-logo.jpeg")} style={{ width: "100%", height: "100%", borderRadius: Math.round(size * 0.17), objectFit: "cover" }} />
  </div>
);

const BrandWatermark: React.FC = () => (
  <div style={{ position: "absolute", top: 0, right: 0, display: "flex", alignItems: "center", gap: 14, color: "rgba(255,255,255,0.68)", fontWeight: 700, letterSpacing: 0, fontSize: 18 }}>
    <span>Created by</span>
    <Img src={staticFile("assets/odiadev-ai.jpeg")} style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 12 }} />
    <span>ODIADEV AI</span>
  </div>
);

const WebsiteMock: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <BrowserFrame>
      <div style={{ background: "#fbfcff", minHeight: 540, padding: 34 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LogoCard size={54} />
            <div>
              <p style={{ margin: 0, color: ink, fontWeight: 800, fontSize: 18 }}>Serenity Royale Hospital</p>
              <p style={{ margin: 0, color: muted, fontSize: 13 }}>Abuja specialist care</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 18, color: "#475467", fontWeight: 700, fontSize: 14 }}>
            <span>Services</span>
            <span>Doctors</span>
            <span>Centers</span>
            <span>Contact</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 32, marginTop: 48, alignItems: "center" }}>
          <div>
            <p style={{ margin: 0, color: gold, fontWeight: 900, letterSpacing: 2.2, fontSize: 13 }}>CONFIDENTIAL SUPPORT</p>
            <h3 style={{ margin: "14px 0", color: ink, fontSize: 52, lineHeight: 0.98 }}>Get help without waiting for office hours.</h3>
            <p style={{ margin: 0, color: "#5a6578", fontSize: 20, lineHeight: 1.45 }}>Speak with Serenity AI on WhatsApp to book an appointment, choose a center, and alert the right care team.</p>
            <button style={{ marginTop: 30, border: 0, borderRadius: 14, background: "#0aa361", color: "white", fontWeight: 900, fontSize: 19, padding: "17px 24px", boxShadow: "0 18px 46px rgba(10,163,97,0.34)" }}>
              Chat on WhatsApp
            </button>
          </div>
          <div style={{ borderRadius: 28, background: `linear-gradient(160deg, ${navy}, #132044)`, padding: 24, color: "white", boxShadow: "0 28px 70px rgba(2,8,31,0.28)" }}>
            <p style={{ margin: 0, fontSize: 15, color: "#cbd5e1" }}>Available now</p>
            <p style={{ margin: "8px 0 14px", fontSize: 34, fontWeight: 900, lineHeight: 1.05 }}>24/7 AI front desk</p>
            {["Appointment booking", "Emergency escalation", "Staff notifications"].map((item, index) => (
              <div key={item} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, opacity: fade(frame, 40 + index * 15, 20) }}>
                <span style={{ width: 11, height: 11, borderRadius: 99, background: gold }} />
                <span style={{ fontSize: 17, color: "#e7ecf7" }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
};

const BrowserFrame: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ borderRadius: 28, overflow: "hidden", background: "#f3f4f6", border: "1px solid rgba(255,255,255,0.24)", boxShadow: "0 38px 100px rgba(0,0,0,0.34)", ...style }}>
    <div style={{ height: 52, background: "#eef2f7", display: "flex", alignItems: "center", gap: 9, padding: "0 20px" }}>
      <span style={browserDot("#ef4444")} />
      <span style={browserDot("#f59e0b")} />
      <span style={browserDot("#22c55e")} />
      <div style={{ marginLeft: 18, borderRadius: 999, background: "white", color: "#64748b", padding: "7px 16px", flex: 1, fontSize: 13 }}>serenityroyalehospital.com</div>
    </div>
    {children}
  </div>
);

const SearchResult: React.FC<{ title: string; body: string; delay: number }> = ({ title, body, delay }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ marginTop: 30, padding: "20px 22px", borderRadius: 16, background: "#f8fafc", border: "1px solid #e5e7eb", opacity: fade(frame, delay, 28), transform: `translateY(${interpolate(frame, [delay, delay + 35], [22, 0], clamp)}px)` }}>
      <p style={{ margin: 0, color: "#1d4ed8", fontSize: 22, fontWeight: 800 }}>{title}</p>
      <p style={{ margin: "8px 0 0", color: "#4b5563", fontSize: 17, lineHeight: 1.35 }}>{body}</p>
    </div>
  );
};

const PhoneFrame: React.FC<{ children: React.ReactNode; compact?: boolean }> = ({ children, compact }) => (
  <div style={{ width: compact ? 460 : 560, height: compact ? 690 : 790, borderRadius: 54, background: "#050816", padding: 18, margin: "0 auto", boxShadow: "0 44px 110px rgba(0,0,0,0.52)", border: "1px solid rgba(255,255,255,0.16)" }}>
    <div style={{ width: "100%", height: "100%", borderRadius: 40, overflow: "hidden", background: "#0b141a", position: "relative" }}>
      <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 120, height: 22, borderRadius: 999, background: "#050816", zIndex: 2 }} />
      {children}
    </div>
  </div>
);

const WhatsAppHeader: React.FC<{ urgent?: boolean }> = ({ urgent }) => (
  <div style={{ height: 82, padding: "22px 20px 14px", background: "#1f2c34", display: "flex", alignItems: "center", gap: 14, color: "white" }}>
    <LogoCard size={46} />
    <div>
      <p style={{ margin: 0, fontWeight: 900, fontSize: 18 }}>{urgent ? "Serenity Emergency Support" : "Serenity AI"}</p>
      <p style={{ margin: "2px 0 0", color: urgent ? "#fecaca" : "#9ca3af", fontSize: 13 }}>{urgent ? "Escalating now" : "online"}</p>
    </div>
  </div>
);

const ChatBubble: React.FC<{ side: "ai" | "user"; delay: number; index: number; children: string }> = ({ side, delay, index, children }) => {
  const frame = useCurrentFrame();
  const show = fade(frame, delay, 20);
  return (
    <div style={{ alignSelf: side === "user" ? "flex-end" : "flex-start", maxWidth: "82%", opacity: show, transform: `translateY(${interpolate(frame, [delay, delay + 24], [18, 0], clamp)}px)` }}>
      <div style={{ background: side === "user" ? "#005c4b" : "#202c33", color: "#f8fafc", borderRadius: side === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding: "12px 14px", fontSize: 15.4, lineHeight: 1.28, boxShadow: "0 8px 18px rgba(0,0,0,0.18)" }}>
        {children}
        <span style={{ display: "block", textAlign: "right", marginTop: 5, color: "rgba(255,255,255,0.55)", fontSize: 11 }}>{`0${Math.floor(index / 2)}:${index % 2 === 0 ? "02" : "14"}`}</span>
      </div>
    </div>
  );
};

const ImpactStack: React.FC<{ frame: number }> = ({ frame }) => {
  const items = [
    ["After hours", "Patient still reaches Serenity."],
    ["Structured prompts", "Name, location, doctor, center, time."],
    ["No lost lead", "The request becomes a dashboard task."],
  ];
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {items.map(([title, body], index) => (
        <div key={title} style={{ ...glassCard, opacity: fade(frame, 60 + index * 55, 30), transform: `translateX(${interpolate(frame, [60 + index * 55, 100 + index * 55], [-42, 0], clamp)}px)` }}>
          <p style={{ margin: 0, color: gold2, fontWeight: 900, fontSize: 25 }}>{title}</p>
          <p style={{ margin: "9px 0 0", color: "#dbe6f8", fontSize: 20, lineHeight: 1.35 }}>{body}</p>
        </div>
      ))}
    </div>
  );
};

const NotificationCard: React.FC<{ title: string; role: string; body: string; color: string; at: number }> = ({ title, role, body, color, at }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ background: "white", borderRadius: 24, minHeight: 286, padding: 26, boxShadow: "0 28px 80px rgba(0,0,0,0.24)", opacity: fade(frame, at, 28), transform: `translateY(${interpolate(frame, [at, at + 36], [38, 0], clamp)}px)` }}>
      <div style={{ width: 56, height: 56, borderRadius: 18, background: color, boxShadow: `0 18px 34px ${color}55`, marginBottom: 18 }} />
      <p style={{ margin: 0, color: ink, fontSize: 27, fontWeight: 900 }}>{title}</p>
      <p style={{ margin: "7px 0 13px", color, fontWeight: 900, fontSize: 15, textTransform: "uppercase", letterSpacing: 1.2 }}>{role}</p>
      <p style={{ margin: 0, color: "#566174", fontSize: 18, lineHeight: 1.36 }}>{body}</p>
    </div>
  );
};

const MiniInbox: React.FC<{ title: string; lines: string[] }> = ({ title, lines }) => (
  <div style={{ ...glassCard, background: "rgba(255,255,255,0.97)", color: ink }}>
    <p style={{ margin: 0, fontWeight: 900, fontSize: 23 }}>{title}</p>
    <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
      {lines.map((line) => (
        <p key={line} style={{ margin: 0, color: line.includes("New") || line.includes("patient") ? ink : "#475467", fontSize: 17, lineHeight: 1.22 }}>{line}</p>
      ))}
    </div>
  </div>
);

const AppointmentOpsPanel: React.FC<{ frame: number }> = ({ frame }) => (
  <div style={{ background: "#f8fafc", borderRadius: 28, border: "1px solid rgba(255,255,255,0.28)", boxShadow: "0 30px 90px rgba(0,0,0,0.34)", overflow: "hidden", opacity: fade(frame, 20, 35) }}>
    <div style={{ background: "#fff", padding: "26px 30px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <p style={{ margin: 0, color: "#98a2b3", fontSize: 14, fontWeight: 800, letterSpacing: 1.4 }}>APPOINTMENTS</p>
        <p style={{ margin: "6px 0 0", color: ink, fontSize: 31, fontWeight: 900 }}>Awaiting secretary review</p>
      </div>
      <button style={primaryButton}>Confirm appointment</button>
    </div>
    <div style={{ padding: 30 }}>
      <div style={{ borderRadius: 22, background: "white", border: "1px solid #e5e7eb", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ margin: 0, color: ink, fontSize: 28, fontWeight: 900 }}>Austyn Samuah</p>
            <p style={{ margin: "8px 0 0", color: "#475467", fontSize: 19 }}>Drug rehabilitation - Galadimawa - Tomorrow, 10:00</p>
          </div>
          <span style={{ borderRadius: 999, background: "#fffbeb", color: "#b45309", padding: "10px 14px", fontWeight: 900 }}>Needs doctor</span>
        </div>
        <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <SelectLike label="Doctor" value={frame > 120 ? "Dr. Grace Ikeh" : "Choose doctor"} active={frame > 120} />
          <SelectLike label="Status" value={frame > 180 ? "Confirmed" : "Pending"} active={frame > 180} />
        </div>
        <div style={{ marginTop: 22, display: "flex", gap: 12 }}>
          <button style={primaryButton}>Confirm appointment</button>
          <button style={secondaryButton}>Retry alerts</button>
          <button style={secondaryButton}>Send reminder</button>
        </div>
      </div>
    </div>
  </div>
);

const SelectLike: React.FC<{ label: string; value: string; active: boolean }> = ({ label, value, active }) => (
  <div style={{ border: `2px solid ${active ? gold : "#e5e7eb"}`, borderRadius: 16, padding: "14px 16px", background: "white" }}>
    <p style={{ margin: 0, color: "#98a2b3", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, textTransform: "uppercase" }}>{label}</p>
    <p style={{ margin: "5px 0 0", color: active ? ink : "#667085", fontSize: 20, fontWeight: 900 }}>{value}</p>
  </div>
);

const OutcomeCard: React.FC<{ delay: number; title: string; value: string; tone: "green" | "gold" | "blue"; body: string }> = ({ delay, title, value, tone, body }) => {
  const frame = useCurrentFrame();
  const color = tone === "green" ? green : tone === "gold" ? gold : "#38bdf8";
  return (
    <div style={{ ...glassCard, opacity: fade(frame, delay, 28), transform: `translateX(${interpolate(frame, [delay, delay + 36], [36, 0], clamp)}px)` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ margin: 0, color: "#dbe7ff", fontSize: 19, fontWeight: 800 }}>{title}</p>
        <span style={{ borderRadius: 999, background: `${color}22`, color, padding: "8px 12px", fontWeight: 900 }}>{value}</span>
      </div>
      <p style={{ margin: "12px 0 0", color: "#c4cfdf", fontSize: 17, lineHeight: 1.35 }}>{body}</p>
    </div>
  );
};

const EmergencyDashboard: React.FC<{ frame: number }> = ({ frame }) => (
  <div style={{ background: "#fff", borderRadius: 30, overflow: "hidden", boxShadow: "0 36px 100px rgba(0,0,0,0.38)", opacity: fade(frame, 80, 38) }}>
    <div style={{ background: navy, color: "white", padding: "26px 30px", display: "flex", alignItems: "center", gap: 16 }}>
      <LogoCard size={54} />
      <div>
        <p style={{ margin: 0, color: gold, fontSize: 14, letterSpacing: 1.5, fontWeight: 900 }}>EMERGENCY DASHBOARD</p>
        <p style={{ margin: "4px 0 0", fontSize: 29, fontWeight: 900 }}>Urgent alert created</p>
      </div>
    </div>
    <div style={{ padding: 30 }}>
      <div style={{ border: `2px solid ${red}`, background: "#fef2f2", borderRadius: 24, padding: 24 }}>
        <p style={{ margin: 0, color: red, fontSize: 15, fontWeight: 900, letterSpacing: 1.4 }}>HIGH PRIORITY</p>
        <p style={{ margin: "9px 0 0", color: ink, fontSize: 31, fontWeight: 900 }}>Possible self-harm risk</p>
        <p style={{ margin: "10px 0 0", color: "#4b5563", fontSize: 18 }}>Patient message contains crisis language. Human clinical review required.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 18 }}>
        <StatusTile title="Secretary" value="Alerted" color={gold} delay={145} />
        <StatusTile title="Dr. K" value="Alerted" color={red} delay={175} />
        <StatusTile title="Dashboard" value="Visible" color={green} delay={205} />
      </div>
    </div>
  </div>
);

const StatusTile: React.FC<{ title: string; value: string; color: string; delay: number }> = ({ title, value, color, delay }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ borderRadius: 18, background: "#f8fafc", border: "1px solid #e5e7eb", padding: 18, opacity: fade(frame, delay, 25) }}>
      <p style={{ margin: 0, color: "#667085", fontWeight: 800, fontSize: 14 }}>{title}</p>
      <p style={{ margin: "8px 0 0", color, fontSize: 21, fontWeight: 900 }}>{value}</p>
    </div>
  );
};

const Callout: React.FC<{ x: number; y: number; delay: number; label: string }> = ({ x, y, delay, label }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity: fade(frame, delay, 22), transform: `translateY(${interpolate(frame, [delay, delay + 24], [16, 0], clamp)}px)` }}>
      <div style={{ borderRadius: 999, background: gold, color: "#111827", padding: "11px 15px", fontWeight: 900, fontSize: 15, boxShadow: "0 18px 44px rgba(231,180,22,0.36)" }}>{label}</div>
    </div>
  );
};

const Pill: React.FC<{ children: string; delay: number }> = ({ children, delay }) => {
  const frame = useCurrentFrame();
  return (
    <span style={{ opacity: fade(frame, delay, 18), border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "#ecf3ff", borderRadius: 999, padding: "12px 17px", fontSize: 17, fontWeight: 800 }}>
      {children}
    </span>
  );
};

const browserDot = (color: string): React.CSSProperties => ({
  width: 13,
  height: 13,
  borderRadius: 99,
  background: color,
});

const glassCard: React.CSSProperties = {
  borderRadius: 24,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.16)",
  boxShadow: "0 20px 70px rgba(0,0,0,0.22)",
  padding: 24,
};

const primaryButton: React.CSSProperties = {
  border: 0,
  borderRadius: 12,
  background: gold,
  color: "#111827",
  padding: "13px 18px",
  fontWeight: 900,
  fontSize: 16,
};

const secondaryButton: React.CSSProperties = {
  border: "1px solid #d0d5dd",
  borderRadius: 12,
  background: "white",
  color: "#344054",
  padding: "13px 18px",
  fontWeight: 800,
  fontSize: 16,
};

const eyebrow = (color: string): React.CSSProperties => ({
  margin: 0,
  color,
  fontSize: 15,
  fontWeight: 900,
  letterSpacing: 3.8,
  textTransform: "uppercase",
});

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
  easing: Easing.bezier(0.16, 1, 0.3, 1),
};

function fade(frame: number, start: number, duration: number) {
  return interpolate(frame, [start, start + duration], [0, 1], clamp);
}

function springIn(frame: number, start: number, duration: number, from: number, to: number) {
  return interpolate(frame, [start, start + duration], [from, to], clamp);
}
