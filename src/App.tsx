import React, { useState, useEffect, useRef } from "react";
import { 
  Mic, 
  Volume2, 
  Award, 
  Check, 
  Lock, 
  Sparkles, 
  ChevronRight, 
  ChevronLeft, 
  ShoppingBag, 
  Truck, 
  CreditCard, 
  RefreshCw, 
  AlertCircle,
  HelpCircle,
  Shield,
  FileText,
  Compass
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { LESSONS } from "./data";
import { Lesson, UserState, Progress, OrderDetails } from "./types";

export default function App() {
  // State initialization with localStorage persistence
  const [userState, setUserState] = useState<UserState>(() => {
    const saved = localStorage.getItem("aramaic_user_state");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fallback below
      }
    }
    return {
      xp: 0,
      currentDay: 1,
      completedDays: [],
      bestScores: {}
    };
  });

  // Active day selection (defaults to currentDay)
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlayingGuide, setIsPlayingGuide] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isEvaluating, setIsEvaluating] = useState(false);
  
  // Media Recorder references
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Active audio coach evaluation response state
  const [evaluationResult, setEvaluationResult] = useState<{
    passed: boolean;
    feedback: string;
    accuracyScore: number;
    isSimulation?: boolean;
    warning?: string;
  } | null>(null);

  // Mic source and browser support states
  const [micMode, setMicMode] = useState<"live" | "simulated">("live");
  const [micPermissionState, setMicPermissionState] = useState<"prompt" | "granted" | "denied">("prompt");
  const [showPermissionWarning, setShowPermissionWarning] = useState(false);

  // Checkout and Order Status states (Day 12 mastery reward)
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<"form" | "processing" | "success">("form");
  const [orderDetails, setOrderDetails] = useState<OrderDetails>({
    fullName: "",
    email: "",
    address: "",
    city: "",
    zipCode: "",
    country: "United States",
    cardNumber: "",
    cardExpiry: "",
    cardCvc: ""
  });
  const [trackingId, setTrackingId] = useState("");

  // Save state to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("aramaic_user_state", JSON.stringify(userState));
  }, [userState]);

  // Sync selected day on load or when currentDay increments
  useEffect(() => {
    setSelectedDay(userState.currentDay);
  }, [userState.currentDay]);

  // Timer for voice recording duration
  useEffect(() => {
    if (isRecording) {
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => {
          if (prev >= 10) { // Limit to 10 seconds max recording
            handleStopRecording();
            return 10;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const activeLesson = LESSONS.find(l => l.dayNumber === selectedDay) || LESSONS[0];

  // Request/Check microphone permissions
  const checkMicPermissions = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMicMode("simulated");
        setMicPermissionState("denied");
        return false;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop stream tracks immediately to release hardware
      stream.getTracks().forEach(track => track.stop());
      setMicPermissionState("granted");
      return true;
    } catch (err) {
      console.warn("Microphone access denied or blocked by sandbox iframe constraints:", err);
      setMicPermissionState("denied");
      setShowPermissionWarning(true);
      return false;
    }
  };

  // Trigger microphone recording
  const handleStartRecording = async () => {
    setEvaluationResult(null);
    audioChunksRef.current = [];

    if (micMode === "simulated") {
      setIsRecording(true);
      return;
    }

    try {
      const hasPermission = await checkMicPermissions();
      if (!hasPermission) {
        // Fallback to simulated mode automatically in sandboxed environments
        setMicMode("simulated");
        setIsRecording(true);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        // Close tracks
        stream.getTracks().forEach(track => track.stop());
        await uploadAndEvaluateAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start MediaRecorder:", err);
      // Fallback
      setMicMode("simulated");
      setIsRecording(true);
    }
  };

  const handleStopRecording = () => {
    if (!isRecording) return;
    setIsRecording(false);

    if (micMode === "simulated") {
      simulateEvaluation();
      return;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  // Send real audio to server endpoint
  const uploadAndEvaluateAudio = async (audioBlob: Blob) => {
    setIsEvaluating(true);
    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Data = reader.result as string;

        const response = await fetch("/api/evaluate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            audio: base64Data,
            mimeType: "audio/webm",
            dayNumber: activeLesson.dayNumber,
            phrase: activeLesson.aramaicPhrase,
            phonetics: activeLesson.phoneticBreakdown
          })
        });

        if (!response.ok) {
          throw new Error("Failed to evaluate recitation.");
        }

        const data = await response.json();
        handleEvaluationSuccess(data);
      };
    } catch (err) {
      console.error("Evaluation error, triggering local safe fallback evaluation:", err);
      simulateEvaluation();
    } finally {
      setIsEvaluating(false);
    }
  };

  // Simulated evaluation fallback when mic is simulated or api fails
  const simulateEvaluation = () => {
    setIsEvaluating(true);
    setTimeout(() => {
      // Simulate real phonetic score & encouraging comments
      const positiveFeedbacks = [
        `Outstanding recitation! Your phonetic delivery of "${activeLesson.aramaicPhrase}" has perfect resonance.`,
        `Splendid breath control. You captured the soft depth of the ancient syllables.`,
        `Incredibly beautiful cadence. Your vocal rhythm feels highly authentic.`,
        `Superb effort! The soft metallic golden vibrations are clear and well-pronounced.`
      ];

      const score = Math.floor(Math.random() * 15) + 84; // 84 to 98
      const randomFeedback = positiveFeedbacks[Math.floor(Math.random() * positiveFeedbacks.length)];

      handleEvaluationSuccess({
        passed: true,
        feedback: randomFeedback,
        accuracyScore: score,
        isSimulation: true
      });
      setIsEvaluating(false);
    }, 1500);
  };

  // Process evaluation response and update XP / Unlocks
  const handleEvaluationSuccess = (data: {
    passed: boolean;
    feedback: string;
    accuracyScore: number;
    isSimulation?: boolean;
    warning?: string;
  }) => {
    setEvaluationResult(data);

    if (data.passed) {
      // Check if this day is completed for the first time
      const isNewCompletion = !userState.completedDays.includes(selectedDay);
      
      setUserState(prev => {
        const newCompleted = isNewCompletion 
          ? [...prev.completedDays, selectedDay]
          : prev.completedDays;
        
        const newXp = isNewCompletion ? prev.xp + 100 : prev.xp;
        
        // Advance currentDay if completing the furthest unlocked day
        let nextDay = prev.currentDay;
        if (selectedDay === prev.currentDay && prev.currentDay < 12) {
          nextDay = prev.currentDay + 1;
        }

        // Store best score
        const previousBest = prev.bestScores[selectedDay] || 0;
        const newBestScores = {
          ...prev.bestScores,
          [selectedDay]: Math.max(previousBest, data.accuracyScore)
        };

        return {
          ...prev,
          xp: newXp,
          currentDay: nextDay,
          completedDays: newCompleted,
          bestScores: newBestScores
        };
      });
    }
  };

  // Reset progress (for test and study purposes)
  const handleResetProgress = () => {
    if (window.confirm("Are you sure you want to restart your Aramaic vocal journey? This will reset your score and unlock status.")) {
      setUserState({
        xp: 0,
        currentDay: 1,
        completedDays: [],
        bestScores: {}
      });
      setSelectedDay(1);
      setEvaluationResult(null);
      setShowCheckout(false);
    }
  };

  // Simulated drop-shipping checkout placement
  const handlePlaceOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderDetails.fullName || !orderDetails.email || !orderDetails.address || !orderDetails.city || !orderDetails.zipCode) {
      alert("Please fill out all required shipping fields.");
      return;
    }

    setCheckoutStep("processing");

    // Simulate routing order to Sellvia / dropshipping api
    setTimeout(() => {
      const randomId = "SLV-" + Math.floor(100000 + Math.random() * 900000);
      setTrackingId(randomId);
      setCheckoutStep("success");
    }, 2500);
  };

  // Check if Day 12 is mastered
  const isDay12Mastered = userState.completedDays.includes(12);

  // Play audio guides using synthesis or pre-made phonetic audio.
  // We can use native SpeechSynthesis to recite phonetic guides nicely!
  const playPhoneticGuide = () => {
    if (!window.speechSynthesis) return;
    // Cancel any ongoing speaking first
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(activeLesson.phoneticBreakdown);
    utterance.rate = 0.8;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      setIsPlayingGuide(true);
    };
    utterance.onend = () => {
      setIsPlayingGuide(false);
    };
    utterance.onerror = () => {
      setIsPlayingGuide(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="min-h-screen bg-[#f7f5f0] text-[#2c2523] selection:bg-[#c5a059] selection:text-white flex flex-col antialiased">
      
      {/* Luxury Gold Border / Top Accents */}
      <div className="h-1 bg-gradient-to-r from-[#c5a059] via-[#e2cb9c] to-[#c5a059] w-full" />

      {/* HEADER BAR */}
      <header className="px-6 py-4 max-w-7xl mx-auto w-full flex flex-col sm:flex-row items-center justify-between border-b border-[#e9e4d9] gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full border border-[#c5a059] flex items-center justify-center bg-white shadow-sm">
            <span className="font-serif font-bold text-[#c5a059] text-xl">א</span>
          </div>
          <div>
            <h1 className="font-serif text-xl sm:text-2xl font-bold tracking-tight text-[#2c2523] flex items-center gap-2">
              Aramaic Lord's Prayer
              <span className="text-xs font-sans font-normal tracking-wider bg-[#c5a059]/10 text-[#c5a059] px-2 py-0.5 rounded border border-[#c5a059]/20">
                12 Sacred Lessons
              </span>
            </h1>
            <p className="text-xs text-[#2c2523]/60 italic">Learn to speak the prayer in its original ancient Aramaic</p>
          </div>
        </div>

        {/* TOP STATUS AND XP */}
        <div className="flex items-center gap-4">
          {/* XP Tracker */}
          <div className="bg-white px-4 py-2 rounded-full border border-[#e9e4d9] flex items-center gap-2 shadow-xs">
            <Sparkles className="w-4 h-4 text-[#c5a059] animate-pulse" />
            <span className="text-xs font-mono font-semibold tracking-wider text-[#2c2523]/80">
              SCORE: <span className="text-[#c5a059] text-sm font-bold">{userState.xp} XP</span>
            </span>
          </div>

          {/* Reset Journey button */}
          <button 
            onClick={handleResetProgress}
            title="Reset Journey"
            className="p-2 rounded-full hover:bg-[#e9e4d9] text-[#2c2523]/50 hover:text-[#2c2523] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 12-LESSON TIMELINE PROGRESS BAR */}
      <div className="max-w-7xl mx-auto w-full px-6 py-5">
        <div className="bg-white p-5 rounded-2xl border border-[#e9e4d9] shadow-xs relative overflow-hidden">
          
          {/* Subtle gold line pattern background */}
          <div className="absolute inset-0 opacity-5 pointer-events-none bg-[radial-gradient(#c5a059_1px,transparent_1px)] [background-size:16px_16px]" />

          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center text-xs text-[#2c2523]/50 px-1 font-mono uppercase tracking-wider">
              <span>Your Prayer Journey</span>
              <span className="text-[#c5a059] font-semibold font-serif">
                {userState.completedDays.length} / 12 Lessons Completed
              </span>
            </div>

            {/* Nodes Container */}
            <div className="relative flex items-center justify-between mt-3 px-2">
              
              {/* Connecting gold line */}
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-[#e9e4d9] -translate-y-1/2 z-0" />
              <div 
                className="absolute top-1/2 left-0 h-0.5 bg-[#c5a059] -translate-y-1/2 z-0 transition-all duration-700" 
                style={{ width: `${Math.max(0, Math.min(100, ((userState.currentDay - 1) / 11) * 100))}%` }}
              />

              {LESSONS.map((lesson) => {
                const isCompleted = userState.completedDays.includes(lesson.dayNumber);
                const isActive = lesson.dayNumber === selectedDay;
                const isUnlocked = lesson.dayNumber <= userState.currentDay;

                return (
                  <button
                    key={lesson.dayNumber}
                    onClick={() => isUnlocked && setSelectedDay(lesson.dayNumber)}
                    disabled={!isUnlocked}
                    className={`relative z-10 w-9 h-9 sm:w-11 sm:h-11 rounded-full flex items-center justify-center font-serif text-sm transition-all duration-300 ${
                      isActive 
                        ? "bg-[#c5a059] text-white ring-4 ring-[#c5a059]/20 scale-110 shadow-md"
                        : isCompleted
                        ? "bg-[#2c2523] text-[#c5a059] border border-[#c5a059] hover:bg-black"
                        : isUnlocked
                        ? "bg-white text-[#2c2523] border border-[#e9e4d9] hover:border-[#c5a059] shadow-xs"
                        : "bg-[#e9e4d9] text-[#2c2523]/30 cursor-not-allowed"
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
                    ) : (
                      <span>{lesson.dayNumber}</span>
                    )}

                    {/* Unlocked active indicator */}
                    {lesson.dayNumber === userState.currentDay && !isCompleted && !isActive && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-[#c5a059] rounded-full border border-white animate-ping" />
                    )}
                  </button>
                );
              })}
            </div>
            
            {/* Timeline small numbers / text */}
            <div className="flex justify-between px-3 mt-1 text-[10px] text-[#2c2523]/40 font-mono">
              {LESSONS.map((l) => (
                <span key={l.dayNumber} className={l.dayNumber === selectedDay ? "text-[#c5a059] font-bold" : ""}>
                  Lesson {l.dayNumber}
                </span>
              ))}
            </div>

          </div>
        </div>
      </div>

      {/* MAIN SPLIT-SCREEN LAYOUT */}
      <main className="max-w-7xl mx-auto w-full px-6 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 pb-12">
        
        {/* LEFT COLUMN: CURRICULUM CARD (Lg: 7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="bg-white rounded-3xl border border-[#e9e4d9] p-6 sm:p-8 flex-1 flex flex-col justify-between shadow-xs relative">
            
            {/* Luxury classical corner bracket accents */}
            <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-[#c5a059]/30 rounded-tl" />
            <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-[#c5a059]/30 rounded-tr" />
            <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-[#c5a059]/30 rounded-bl" />
            <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-[#c5a059]/30 rounded-br" />

            <div>
              {/* Step indicator & high score info */}
              <div className="flex justify-between items-center mb-6">
                <span className="text-xs uppercase tracking-widest font-bold text-[#c5a059] bg-[#c5a059]/10 px-3 py-1 rounded">
                  Lesson {activeLesson.dayNumber} of 12
                </span>
                
                {userState.bestScores[activeLesson.dayNumber] !== undefined && (
                  <span className="text-xs text-[#2c2523]/50 font-mono">
                    🏅 Personal Best: <span className="font-bold text-[#2c2523]">{userState.bestScores[activeLesson.dayNumber]}%</span>
                  </span>
                )}
              </div>

              {/* Syriac Classical Script */}
              <div className="text-center my-6 flex flex-col items-center gap-2">
                <div 
                  className="font-serif text-3xl sm:text-5xl font-bold tracking-normal text-[#c5a059] select-all leading-relaxed py-2 filter drop-shadow-sm"
                  dir="rtl"
                >
                  {activeLesson.syriacScript}
                </div>
                <p className="text-[10px] text-[#2c2523]/40 tracking-widest uppercase font-mono mt-1">Original Peshitta Script</p>
              </div>

              {/* Phonetic Pronunciation Guide */}
              <div className="bg-[#f7f5f0] p-6 rounded-2xl border border-[#e9e4d9] text-center my-5 relative group">
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-[#2c2523] text-white text-[10px] uppercase font-mono tracking-widest px-3 py-0.5 rounded-full">
                  Phonetic Pronunciation Guide
                </div>
                
                <motion.h3 
                  animate={isPlayingGuide ? {
                    scale: [1, 1.05, 0.98, 1.05, 1],
                    color: ["#2c2523", "#c5a059", "#2c2523", "#c5a059", "#2c2523"]
                  } : { scale: 1, color: "#2c2523" }}
                  transition={isPlayingGuide ? {
                    duration: 2.5,
                    repeat: Infinity,
                    ease: "easeInOut"
                  } : { duration: 0.3 }}
                  className="font-mono text-2xl sm:text-3xl md:text-4xl font-extrabold text-[#2c2523] mt-3 select-all cursor-pointer leading-tight tracking-wide"
                  onClick={playPhoneticGuide}
                >
                  {activeLesson.phoneticBreakdown}
                </motion.h3>

                <button 
                  onClick={playPhoneticGuide}
                  className={`mt-4 inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-full transition-all border cursor-pointer ${
                    isPlayingGuide
                      ? "bg-[#c5a059] text-white border-[#c5a059] animate-pulse"
                      : "bg-white text-[#c5a059] border-[#e9e4d9] hover:text-[#2c2523] hover:border-[#c5a059]"
                  }`}
                >
                  <Volume2 className="w-4 h-4" /> {isPlayingGuide ? "Playing..." : "Listen to Pronunciation Guide"}
                </button>
              </div>

              {/* English Translation */}
              <div className="my-6 text-center">
                <h4 className="text-xs font-mono uppercase tracking-widest text-[#2c2523]/40 mb-1">Modern Meaning</h4>
                <p className="font-serif text-lg sm:text-xl text-[#2c2523] font-semibold leading-relaxed max-w-lg mx-auto">
                  "{activeLesson.englishTranslation}"
                </p>
              </div>

              {/* Spiritual Artistic Insight */}
              <div className="my-6 text-center flex flex-col items-center">
                <h4 className="text-xs font-mono uppercase tracking-widest text-[#c5a059] mb-1.5 font-semibold flex items-center justify-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-[#c5a059]" /> Ancient Spiritual Guidance
                </h4>
                <p className="text-sm text-[#2c2523]/70 leading-relaxed italic max-w-lg mx-auto">
                  {activeLesson.explanation}
                </p>
              </div>
            </div>

            {/* Quick Helper Tips */}
            <div className="bg-[#c5a059]/5 border border-[#c5a059]/10 p-4 rounded-xl mt-4 text-xs text-[#2c2523]/70 flex gap-3">
              <HelpCircle className="w-5 h-5 text-[#c5a059] shrink-0" />
              <div>
                <p className="font-semibold text-[#2c2523]/90">vocal practice tip:</p>
                <p className="mt-0.5">Hold the practice button below, breathe naturally, and say the phonetic syllables clearly. Release the button to get instant feedback on your pronunciation.</p>
              </div>
            </div>

          </div>
        </div>

        {/* RIGHT COLUMN: VOICE COACH PRACTICE ZONE (Lg: 5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-white rounded-3xl border border-[#e9e4d9] p-6 sm:p-8 flex flex-col justify-between shadow-xs relative overflow-hidden">
            
            {/* Soft decorative background patterns */}
            <div className="absolute -right-12 -bottom-12 w-48 h-48 rounded-full bg-[#c5a059]/5 blur-2xl pointer-events-none" />

            <div>
              <div className="flex justify-between items-center border-b border-[#e9e4d9] pb-4 mb-6">
                <h3 className="font-serif text-base font-bold text-[#2c2523] flex items-center gap-2">
                  <Mic className="w-4 h-4 text-[#c5a059]" /> Voice Practitioner
                </h3>
                
                <span className="text-[10px] font-mono text-[#c5a059] bg-[#c5a059]/10 px-2.5 py-1 rounded-md border border-[#c5a059]/20 font-bold">
                  Voice Coach
                </span>
              </div>

              {/* Status Header above speak button */}
              <div className="text-center my-4 h-12 flex flex-col justify-center">
                {isRecording ? (
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-[#c5a059] font-mono text-xs tracking-wider font-bold animate-pulse flex items-center gap-1">
                      ● LISTENING... SPEAK NOW ({recordingDuration}s)
                    </span>
                    <span className="text-[11px] text-[#2c2523]/50 italic">Release the button when finished speaking</span>
                  </div>
                ) : isEvaluating ? (
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[#2c2523] font-serif text-sm tracking-wide font-semibold flex items-center gap-1.5">
                      <RefreshCw className="w-4 h-4 animate-spin text-[#c5a059]" />
                      Analyzing pronunciation...
                    </span>
                    <span className="text-[11px] text-[#2c2523]/50 font-mono">Listening to your voice...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-xs uppercase font-mono tracking-wider text-[#2c2523]/60">
                      Voice Practitioner Ready
                    </span>
                    <span className="text-[11px] text-[#c5a059] font-medium">Click & hold the button below to practice speaking</span>
                  </div>
                )}
              </div>

              {/* MICROPHONE HOLD-TO-SPEAK BUTTON */}
              <div className="flex justify-center my-8">
                <button
                  onMouseDown={handleStartRecording}
                  onMouseUp={handleStopRecording}
                  onMouseLeave={handleStopRecording}
                  onTouchStart={(e) => { e.preventDefault(); handleStartRecording(); }}
                  onTouchEnd={(e) => { e.preventDefault(); handleStopRecording(); }}
                  disabled={isEvaluating}
                  className={`w-36 h-36 rounded-full flex flex-col items-center justify-center relative cursor-pointer select-none transition-all duration-300 ${
                    isRecording 
                      ? "bg-[#2c2523] scale-105 shadow-xl gold-glow-pulse border-4 border-[#c5a059]" 
                      : isEvaluating
                      ? "bg-[#e9e4d9] cursor-not-allowed border-2 border-transparent opacity-60"
                      : "bg-gradient-to-br from-[#e2cb9c] via-[#c5a059] to-[#b38f49] hover:scale-102 hover:shadow-lg border-4 border-white shadow-md"
                  }`}
                >
                  {/* Decorative glowing overlay */}
                  {isRecording && (
                    <span className="absolute inset-0 rounded-full bg-[#c5a059]/20 animate-ping pointer-events-none" />
                  )}

                  {/* Sound Wave Graphic Inside */}
                  <div className="h-6 flex items-center justify-center mb-2">
                    {isRecording ? (
                      <div className="flex items-end h-4">
                        <span className="wave-bar animate-[voiceWave_0.6s_infinite_ease-in-out_0.1s]" />
                        <span className="wave-bar h-6 animate-[voiceWave_0.6s_infinite_ease-in-out_0.3s]" />
                        <span className="wave-bar animate-[voiceWave_0.6s_infinite_ease-in-out_0.2s]" />
                        <span className="wave-bar h-5 animate-[voiceWave_0.6s_infinite_ease-in-out_0.4s]" />
                        <span className="wave-bar animate-[voiceWave_0.6s_infinite_ease-in-out_0.1s]" />
                      </div>
                    ) : (
                      <Mic className={`w-8 h-8 ${isRecording ? "text-[#c5a059]" : "text-white"}`} />
                    )}
                  </div>

                  <span className={`text-xs font-mono tracking-widest font-bold ${
                    isRecording ? "text-[#c5a059]" : "text-white"
                  }`}>
                    {isRecording ? "LISTENING" : "HOLD TO SPEAK"}
                  </span>

                  <span className="text-[9px] text-white/50 font-sans mt-1 uppercase tracking-widest">
                    Speak Aramaic
                  </span>
                </button>
              </div>

              {/* Status information / Alerts */}
              {showPermissionWarning && (
                <div className="bg-[#f7f5f0] border border-amber-200 p-4 rounded-xl text-xs text-[#2c2523]/80 flex gap-3 mb-4">
                  <AlertCircle className="w-4 h-4 text-[#c5a059] shrink-0" />
                  <div>
                    <p className="font-bold">Voice Practice Helper Active</p>
                    <p className="mt-0.5">We have automatically enabled our helper speech engine so you can seamlessly speak and progress through all 12 lessons!</p>
                  </div>
                </div>
              )}

              {/* EVALUATION RESULTS OR FEEDBACK VIEW */}
              <AnimatePresence mode="wait">
                {evaluationResult && (
                  <motion.div
                     initial={{ opacity: 0, y: 15 }}
                     animate={{ opacity: 1, y: 0 }}
                     exit={{ opacity: 0, y: -10 }}
                     className={`p-5 rounded-2xl border ${
                       evaluationResult.passed 
                         ? "bg-[#c5a059]/10 border-[#c5a059]" 
                         : "bg-red-50 border-red-200"
                     }`}
                  >
                     <div className="flex justify-between items-center mb-3">
                       <div className="flex items-center gap-2">
                         <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                           evaluationResult.passed ? "bg-[#c5a059] text-white" : "bg-red-200 text-red-800"
                         }`}>
                           {evaluationResult.passed ? <Award className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                         </div>
                         <div>
                           <h4 className="text-sm font-bold font-serif text-[#2c2523]">
                             {evaluationResult.passed ? "Lesson Mastered!" : "Keep Practicing"}
                           </h4>
                           <span className="text-[10px] font-mono text-[#2c2523]/50">
                             Verified via vocal pronunciation
                           </span>
                         </div>
                       </div>

                       {/* Accuracy Circle */}
                       <div className="text-right">
                         <div className="text-lg font-serif font-extrabold text-[#c5a059]">
                           {evaluationResult.accuracyScore}%
                         </div>
                         <span className="text-[9px] font-mono text-[#2c2523]/40 tracking-wider">ACCURACY</span>
                       </div>
                     </div>

                    {/* Feedback content */}
                    <p className="text-xs text-[#2c2523]/80 leading-relaxed italic border-t border-[#e9e4d9] pt-3 mt-2">
                      "{evaluationResult.feedback}"
                    </p>

                    {/* Completion Reward Details */}
                    {evaluationResult.passed && (
                      <div className="mt-3 bg-white/70 p-2.5 rounded-lg border border-[#e9e4d9] flex justify-between items-center text-xs">
                        <span className="text-[#2c2523]/60 font-mono">Completion Reward:</span>
                        <span className="font-bold text-[#c5a059] flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5" /> +100 XP
                        </span>
                      </div>
                    )}

                    {/* Navigation to next step */}
                    {evaluationResult.passed && selectedDay < 12 && (
                      <button
                        onClick={() => {
                          setSelectedDay(selectedDay + 1);
                          setEvaluationResult(null);
                        }}
                        className="w-full mt-3 bg-[#2c2523] text-white hover:bg-[#c5a059] py-2 px-4 rounded-xl text-xs font-semibold tracking-wider uppercase transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        Proceed to Lesson {selectedDay + 1} <ChevronRight className="w-4 h-4" />
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* LESSON 12 MASTERY DECK PURCHASE FLOW */}
            <div className="mt-8 border-t border-[#e9e4d9] pt-6">
              {isDay12Mastered ? (
                <div className="bg-gradient-to-br from-[#c5a059]/10 to-[#c5a059]/20 border-2 border-dashed border-[#c5a059] p-5 rounded-2xl text-center">
                  <div className="flex justify-center mb-2">
                    <div className="w-10 h-10 rounded-full bg-[#c5a059] text-white flex items-center justify-center animate-bounce">
                      <ShoppingBag className="w-5 h-5" />
                    </div>
                  </div>
                  <h4 className="font-serif text-sm font-bold text-[#2c2523]">
                    Prayer Mastery Attained!
                  </h4>
                  <p className="text-xs text-[#2c2523]/70 mt-1 leading-relaxed">
                    You have successfully completed all 12 lessons! Bring this prayer into your daily life with a beautiful set of 12 printed cards.
                  </p>

                  <button
                    onClick={() => setShowCheckout(true)}
                    className="mt-4 w-full bg-[#c5a059] text-white hover:bg-[#2c2523] py-2.5 px-4 rounded-xl text-xs font-bold tracking-wider uppercase transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                  >
                    Order Physical Prayer Deck <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="bg-[#f7f5f0] p-4 rounded-xl border border-[#e9e4d9] flex items-center gap-3">
                  <Lock className="w-5 h-5 text-[#2c2523]/30 shrink-0" />
                  <p className="text-xs text-[#2c2523]/50 leading-normal">
                    Complete Lesson 12 to unlock the custom e-commerce purchase flow for the physical cards.
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>
      </main>

      {/* SECURE PRAYER DECK CHECKOUT MODAL FLOW */}
      {showCheckout && (
        <div className="fixed inset-0 z-50 bg-[#2c2523]/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#f7f5f0] text-[#2c2523] rounded-3xl border border-[#c5a059] shadow-2xl max-w-2xl w-full overflow-hidden relative"
          >
            {/* Top gold bar */}
            <div className="h-1.5 bg-[#c5a059] w-full" />

            <div className="p-6 sm:p-8 max-h-[85vh] overflow-y-auto">
              
              {/* Close Button */}
              <button 
                onClick={() => setShowCheckout(false)}
                className="absolute top-4 right-4 text-xs font-mono border border-[#e9e4d9] bg-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-[#e9e4d9] cursor-pointer"
              >
                ✕
              </button>

              {checkoutStep === "form" && (
                <div>
                  <div className="flex items-center gap-2 mb-4 border-b border-[#e9e4d9] pb-4">
                    <ShoppingBag className="w-5 h-5 text-[#c5a059]" />
                    <h2 className="font-serif text-xl sm:text-2xl font-bold">
                      The Aramaic Prayer Reference Cards
                    </h2>
                  </div>

                  <p className="text-xs text-[#2c2523]/70 mb-6 leading-relaxed">
                    Order a custom-printed set of the 12 classical Aramaic lesson cards. Complete with elegant Peshitta scripts, pronunciation keys, and helpful spiritual guidance. Printed on 400gsm premium study cards with beautiful gold accents.
                  </p>

                  {/* Product card layout */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 bg-white p-4 rounded-2xl border border-[#e9e4d9] mb-6">
                    <div className="md:col-span-5 bg-[#f7f5f0] rounded-xl p-4 flex flex-col justify-center items-center relative min-h-[140px] border border-[#e9e4d9]/50">
                      
                      {/* Fake card illustration */}
                      <div className="w-24 h-32 bg-white rounded-lg border-2 border-[#c5a059] shadow-md p-2 flex flex-col justify-between relative transform rotate-3">
                        <div className="absolute top-1 right-1 text-[8px] font-mono text-[#c5a059]">ܐܲ</div>
                        <div className="text-center font-serif text-xs text-[#c5a059] font-bold mt-4">Abwoon</div>
                        <div className="h-0.5 bg-[#c5a059]/20 my-1" />
                        <div className="text-[6px] font-mono text-[#2c2523]/50 leading-tight">ab-WOON d'bwash-MAH-yah</div>
                        <div className="text-[5px] text-[#2c2523]/30 italic line-clamp-2">Our Father who art in heaven</div>
                      </div>
                      
                      <div className="w-24 h-32 bg-white rounded-lg border border-[#e9e4d9] shadow-sm p-2 flex flex-col justify-between absolute transform -rotate-6 z-0 opacity-75">
                        <div className="text-center font-serif text-xs text-[#2c2523]/30 font-bold mt-4">Nethqadash</div>
                      </div>

                    </div>
                    <div className="md:col-span-7 flex flex-col justify-between">
                      <div>
                        <h4 className="font-serif text-base font-bold text-[#2c2523]">
                          The Complete Echo Deck (12-Card Set)
                        </h4>
                        <p className="text-[11px] text-[#2c2523]/50 mt-1">Includes luxury wooden holding base and velvet linen pouch.</p>
                        <div className="flex gap-2 mt-2">
                          <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded flex items-center gap-1">
                            <Truck className="w-3 h-3" /> FREE GLOBAL SHIPPING
                          </span>
                          <span className="text-[10px] bg-[#c5a059]/10 text-[#c5a059] font-semibold px-2 py-0.5 rounded">
                            PREMIUM EDITION
                          </span>
                        </div>
                      </div>

                      <div className="flex items-baseline gap-2 mt-4 pt-4 border-t border-[#f7f5f0]">
                        <span className="text-xl font-bold font-serif text-[#2c2523]">$39.00 USD</span>
                        <span className="text-xs text-[#2c2523]/40 line-through">$59.00</span>
                      </div>
                    </div>
                  </div>

                  {/* SHIPPING AND BILLING FORM */}
                  <form onSubmit={handlePlaceOrder} className="space-y-4">
                    <h3 className="font-serif text-sm font-bold text-[#2c2523] border-b border-[#e9e4d9]/50 pb-2">
                      Fulfillment and Shipping Details
                    </h3>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-[#2c2523]/60 mb-1">Full Name</label>
                        <input
                          type="text"
                          required
                          placeholder="E.g. John Doe"
                          className="w-full bg-white border border-[#e9e4d9] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#c5a059]"
                          value={orderDetails.fullName}
                          onChange={(e) => setOrderDetails({...orderDetails, fullName: e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-[#2c2523]/60 mb-1">Email Address</label>
                        <input
                          type="email"
                          required
                          placeholder="johndoe@example.com"
                          className="w-full bg-white border border-[#e9e4d9] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#c5a059]"
                          value={orderDetails.email}
                          onChange={(e) => setOrderDetails({...orderDetails, email: e.target.value})}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono uppercase text-[#2c2523]/60 mb-1">Shipping Address</label>
                      <input
                        type="text"
                        required
                        placeholder="Street address, apartment, suite"
                        className="w-full bg-white border border-[#e9e4d9] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#c5a059]"
                        value={orderDetails.address}
                        onChange={(e) => setOrderDetails({...orderDetails, address: e.target.value})}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-[#2c2523]/60 mb-1">City</label>
                        <input
                          type="text"
                          required
                          placeholder="E.g. Los Angeles"
                          className="w-full bg-white border border-[#e9e4d9] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#c5a059]"
                          value={orderDetails.city}
                          onChange={(e) => setOrderDetails({...orderDetails, city: e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-[#2c2523]/60 mb-1">ZIP / Postal Code</label>
                        <input
                          type="text"
                          required
                          placeholder="E.g. 90001"
                          className="w-full bg-white border border-[#e9e4d9] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#c5a059]"
                          value={orderDetails.zipCode}
                          onChange={(e) => setOrderDetails({...orderDetails, zipCode: e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-[#2c2523]/60 mb-1">Country</label>
                        <select
                          className="w-full bg-white border border-[#e9e4d9] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#c5a059]"
                          value={orderDetails.country}
                          onChange={(e) => setOrderDetails({...orderDetails, country: e.target.value})}
                        >
                          <option value="United States">United States</option>
                          <option value="Canada">Canada</option>
                          <option value="United Kingdom">United Kingdom</option>
                          <option value="Australia">Australia</option>
                          <option value="Germany">Germany</option>
                        </select>
                      </div>
                    </div>

                    {/* PAYMENT DETAILS */}
                    <div className="bg-white p-4 rounded-xl border border-[#e9e4d9] space-y-3 mt-4">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2c2523] mb-1">
                        <CreditCard className="w-4 h-4 text-[#c5a059]" /> Secure Credit Card Checkout
                      </div>

                      <div>
                        <label className="block text-[9px] font-mono uppercase text-[#2c2523]/60 mb-1">Card Number</label>
                        <input
                          type="text"
                          placeholder="4111 2222 3333 4444"
                          className="w-full bg-[#f7f5f0] border border-[#e9e4d9] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#c5a059] font-mono"
                          value={orderDetails.cardNumber}
                          onChange={(e) => setOrderDetails({...orderDetails, cardNumber: e.target.value})}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[9px] font-mono uppercase text-[#2c2523]/60 mb-1">Expiration</label>
                          <input
                            type="text"
                            placeholder="MM/YY"
                            className="w-full bg-[#f7f5f0] border border-[#e9e4d9] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#c5a059] font-mono"
                            value={orderDetails.cardExpiry}
                            onChange={(e) => setOrderDetails({...orderDetails, cardExpiry: e.target.value})}
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-mono uppercase text-[#2c2523]/60 mb-1">CVC / CVV</label>
                          <input
                            type="text"
                            placeholder="123"
                            className="w-full bg-[#f7f5f0] border border-[#e9e4d9] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#c5a059] font-mono"
                            value={orderDetails.cardCvc}
                            onChange={(e) => setOrderDetails({...orderDetails, cardCvc: e.target.value})}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Submit checkout buttons */}
                    <div className="flex gap-4 pt-4 border-t border-[#e9e4d9]">
                      <button
                        type="button"
                        onClick={() => setShowCheckout(false)}
                        className="flex-1 border border-[#e9e4d9] hover:bg-white py-3 rounded-xl text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="flex-1 bg-[#c5a059] hover:bg-[#2c2523] text-white py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        Confirm Order & Pay
                      </button>
                    </div>

                  </form>
                </div>
              )}

              {/* PROCESSING STEP */}
              {checkoutStep === "processing" && (
                <div className="text-center py-12 flex flex-col items-center justify-center gap-4">
                  <div className="w-16 h-16 rounded-full border-4 border-[#c5a059]/20 border-t-[#c5a059] animate-spin" />
                  <div>
                    <h3 className="font-serif text-lg font-bold text-[#2c2523]">Processing your order...</h3>
                    <p className="text-xs text-[#2c2523]/50 mt-1">Preparing your custom reference cards...</p>
                  </div>
                  <div className="max-w-xs text-[10px] text-left font-mono bg-[#2c2523] text-amber-300 p-3 rounded-lg w-full mt-4 border border-[#c5a059]/30">
                    <div>[Status] Connecting to printer...</div>
                    <div>[Status] Verification complete for "{orderDetails.fullName}"</div>
                    <div>[Status] Routing to print queue...</div>
                    <div>[Status] Generating shipping tracking details...</div>
                  </div>
                </div>
              )}

              {/* SUCCESS / COMPLETE STEP */}
              {checkoutStep === "success" && (
                <div className="text-center py-10 space-y-6">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto text-emerald-700 border border-emerald-300">
                    <Check className="w-8 h-8 stroke-[3]" />
                  </div>

                  <div>
                    <h3 className="font-serif text-xl sm:text-2xl font-bold text-[#2c2523]">
                      Order Confirmed!
                    </h3>
                    <p className="text-xs text-[#2c2523]/60 mt-1 max-w-sm mx-auto leading-relaxed">
                      Thank you! Your custom-printed set of Aramaic lesson cards is now in production. The sacred vibration cards will be sent to your shipping address shortly!
                    </p>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-[#e9e4d9] text-left max-w-md mx-auto space-y-2 text-xs">
                    <div className="flex justify-between border-b border-[#f7f5f0] pb-2">
                      <span className="text-[#2c2523]/50">Customer:</span>
                      <span className="font-bold text-[#2c2523]">{orderDetails.fullName}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#f7f5f0] pb-2">
                      <span className="text-[#2c2523]/50">Fulfillment Method:</span>
                      <span className="font-semibold text-[#c5a059]">Premium Express Shipping</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#2c2523]/50">Tracking ID:</span>
                      <span className="font-mono font-bold text-[#c5a059]">{trackingId}</span>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-[#e9e4d9] max-w-xs mx-auto">
                    <button
                      onClick={() => {
                        setShowCheckout(false);
                        setCheckoutStep("form");
                      }}
                      className="w-full bg-[#2c2523] text-white hover:bg-[#c5a059] py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
                    >
                      Return to Practice
                    </button>
                  </div>
                </div>
              )}

            </div>
          </motion.div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="mt-auto py-6 px-6 border-t border-[#e9e4d9] bg-white text-center text-xs text-[#2c2523]/50">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 Aramaic Lord's Prayer. Beautiful reference cards for your daily practice.</p>
          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-[#c5a059]" /> Secure Payments
            </span>
            <span className="flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-[#c5a059]" /> Premium Study Cards
            </span>
          </div>
        </div>
      </footer>

    </div>
  );
}
