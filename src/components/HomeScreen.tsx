import React, { useState, useEffect, useRef } from 'react';
import { Goal, User } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Check, Edit2, Trash2, Plus, ArrowLeft, Loader2, X, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { Panda } from './Panda';
import { PandaIcon } from './PandaIcon';
import { generateGoal, transcribeAudio, StructuredGoal, GoalTask } from '../services/geminiService';
import { GOAL_CATEGORIES } from '../lib/goalCategories';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useTranslation } from '../contexts/LanguageContext';
import { mapLanguageNameToCode } from '../lib/translations';
import { DraggableInputWidget } from './DraggableInputWidget';
import { EditableGoalCards }    from './EditableGoalCards';
import { GoalStackCarousel }    from './GoalStackCarousel';
import { Skeleton }             from './Skeleton';
import { useHomeEditMode }      from '../contexts/HomeEditModeContext';

interface HomeScreenProps {
  user: any;
  dbUser: User | null;
  goals: Goal[];
  goalsLoading?: boolean;
  hasMoreGoals?: boolean;
  loadMoreGoals?: () => void;
  setCurrentScreen: (screen: any) => void;
  handleFirestoreError: (error: unknown, operationType: any, path: string | null) => void;
  addOptimisticGoal: (goal: Goal) => void;
  performSaveGoal: (goal: Goal) => Promise<void>;
}

// ── Progress Ring ─────────────────────────────────────────────────────────────
function ProgressRing({ pct, size = 56 }: { pct: number; size?: number }) {
  const r     = (size - 8) / 2;
  const circ  = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} strokeWidth={5} fill="none"
          stroke="var(--c-border)" />
        <circle cx={size/2} cy={size/2} r={r} strokeWidth={5} fill="none"
          stroke="var(--c-gold)" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          /* POLISH: token ease, willChange on stroke-dashoffset (compositor hint). */
          style={{ transition: 'stroke-dashoffset .6s var(--ease-out-quad)', willChange: 'stroke-dashoffset' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-gold)' }}>{pct}%</span>
      </div>
    </div>
  );
}

// ── Greeting helper ───────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function motivational() {
  const lines = [
    'Keep moving. One small step today.',
    'Progress over perfection.',
    'Your goals are waiting.',
    'Small steps, big change.',
    'Every day counts.',
  ];
  return lines[new Date().getDay() % lines.length];
}

// ── GoalCard animation constants (hoisted to avoid re-triggering on re-render)
const CARD_INITIAL = { opacity: 0, y: 16 as number };    /* POLISH: transform-only enter (was scale) */
const CARD_ANIMATE = { opacity: 1, y: 0  as number };

/* POLISH: shared ease + stagger step — mirrors --ease-out-quad / 40ms in animations.css */
const POL_EASE        = [0.25, 0.46, 0.45, 0.94] as const;
const POL_DUR_PANEL   = 0.3;
const POL_DUR_MICRO   = 0.16;
const POL_STAGGER_MS  = 0.04;  // 40 ms per card

// ── Goal Card Skeleton ────────────────────────────────────────────────────────
function GoalCardSkeleton() {
  return (
    <div
      className="card flex flex-col gap-3"
      /* POLISH: unified radius + layered shadow + containment, matches GoalCard */
      style={{
        borderRadius: 'var(--r-lg)',
        padding:      '16px 16px 14px',
        minWidth:     240,
        maxWidth:     260,
        flexShrink:   0,
        boxShadow:    'var(--shadow-1), var(--shadow-2)',
        contain:      'layout style paint',
      }}
    >
      {/* POLISH: shared Skeleton primitive drives the translateX shimmer (GPU). */}
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-2">
          <Skeleton variant="text"  width="75%" height={14} />
          <Skeleton variant="text"  width="55%" height={10} />
        </div>
        <Skeleton variant="circle" width={44} height={44} />
      </div>
      <Skeleton variant="block" height={32} radius="var(--r-md)" />
    </div>
  );
}

// ── Goal Card ─────────────────────────────────────────────────────────────────
function GoalCard({ goal, onOpen, fillContainer = false, index = 0 }: { goal: Goal; onOpen: () => void; fillContainer?: boolean; index?: number }) {
  const nextStep = (goal as any).nextStep || null;

  return (
    <motion.div
      initial={CARD_INITIAL}
      animate={CARD_ANIMATE}
      /* POLISH: 40ms stagger between cards, shared ease, transform+opacity only */
      transition={{ duration: POL_DUR_PANEL, ease: POL_EASE, delay: index * POL_STAGGER_MS }}
      onClick={onOpen}
      /* POLISH: anim-press for a tactile scale pulse on tap; hit area is the full card. */
      className="card anim-press flex flex-col gap-3 cursor-pointer"
      style={{
        /* POLISH: unified radius to --r-lg (16px), layered shadow (ambient + key),
           paint containment so the card's internal work doesn't invalidate the grid. */
        borderRadius: 'var(--r-lg)',
        padding:      '16px 16px 14px',
        boxShadow:    'var(--shadow-1), var(--shadow-2)',
        contain:      'layout style paint',
        ...(fillContainer
          ? { width: '100%', height: '100%', minWidth: 'unset', maxWidth: 'unset', boxSizing: 'border-box', overflow: 'hidden' }
          : { minWidth: 240, maxWidth: 260, flexShrink: 0 }),
      }}
    >
      {/* Top row — title + ring */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-card-title leading-snug truncate" style={{ fontSize: 14 }}>{goal.title}</h3>
          <p className="text-meta line-clamp-2 mt-0.5" style={{ color: 'var(--c-text-2)', fontSize: 12 }}>
            {goal.description}
          </p>
        </div>
        <ProgressRing pct={goal.progressPercent ?? 0} size={44} />
      </div>

      {/* Next step */}
      {nextStep && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
             style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
          <ChevronRight size={12} style={{ color: 'var(--c-gold)', flexShrink: 0 }} />
          <p className="text-meta truncate" style={{ color: 'var(--c-text-2)', fontSize: 11 }}>
            {nextStep}
          </p>
        </div>
      )}

      {/* Saving indicator */}
      {goal.savingStatus === 'saving' && (
        <div className="flex items-center gap-1.5" style={{ color: 'var(--c-text-3)' }}>
          <Loader2 size={11} className="animate-spin" />
          <span className="text-meta" style={{ fontSize: 11 }}>Saving…</span>
        </div>
      )}

      {/* POLISH: error state — uses shared .error-state utility (red accent,
          4.5:1 contrast, role=alert for SR). "Partial" keeps the gold tint
          since it's a warning, not a failure. */}
      {goal.savingStatus === 'error' && goal.saveErrorMessage && (
        <div
          role="alert"
          className="error-state"
          style={{ padding: '8px 10px' }}
        >
          <span className="error-state__body">{goal.saveErrorMessage}</span>
        </div>
      )}
      {goal.savingStatus === 'partial' && goal.saveErrorMessage && (
        <div
          role="status"
          className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg"
          style={{
            background:   'rgba(201,168,76,.08)',
            border:       '1px solid rgba(201,168,76,.25)',
            color:        'var(--c-gold)',
            borderRadius: 'var(--r-md)',
          }}
        >
          <span className="text-meta" style={{ fontSize: 11, lineHeight: 1.4 }}>{goal.saveErrorMessage}</span>
        </div>
      )}

    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export function HomeScreen({
  user,
  dbUser,
  goals,
  goalsLoading = false,
  hasMoreGoals = false,
  loadMoreGoals,
  setCurrentScreen,
  handleFirestoreError,
  addOptimisticGoal,
  performSaveGoal,
}: HomeScreenProps) {
// ═════════════════════════════════════════════════════════════════════════════

  const { t, setLanguage } = useTranslation();
  const { isEditMode } = useHomeEditMode();

  // ── View state ───────────────────────────────────────────────────────────
  const [currentView, setCurrentView] = useState<'home' | 'recording' | 'review'>('home');

  // ── Voice / transcript state ─────────────────────────────────────────────
  const [phase,            setPhase]            = useState<'idle' | 'generating' | 'saving'>('idle');
  const [processingError,  setProcessingError]  = useState<string | null>(null);
  const [currentTranscript,setCurrentTranscript]= useState<string | null>(null);
  const [structuredGoal,   setStructuredGoal]   = useState<StructuredGoal | null>(null);
  const [isTyping,         setIsTyping]         = useState(false);
  const [typedGoal,        setTypedGoal]        = useState('');
  const [refinementCount,  setRefinementCount]  = useState(0);
  const [isAddingDetails,  setIsAddingDetails]  = useState(false);
  const [additionalDetails,setAdditionalDetails]= useState('');
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [manualTasks,      setManualTasks]      = useState<string[]>([]);
  const [newTaskInput,     setNewTaskInput]     = useState('');
  const [editingManualTaskIndex, setEditingManualTaskIndex] = useState<number | null>(null);
  const [editingManualTaskText,  setEditingManualTaskText]  = useState('');
  const REFINEMENT_LIMIT = 5;

  const { isRecording, startRecording, stopRecording, error: recorderError } = useAudioRecorder();
  const fetchAbortRef = useRef<AbortController | null>(null);

  /* POLISH: lock body scroll whenever a full-screen view (recording / review) is
     open, to kill iOS rubber-band and background scroll-through. */
  useEffect(() => {
    const lock = currentView === 'recording' || currentView === 'review';
    document.body.classList.toggle('body-locked', lock);
    return () => document.body.classList.remove('body-locked');
  }, [currentView]);

  // Auto-resize textareas on review screen
  useEffect(() => {
    if (currentView !== 'review') return;
    const adjust = () => {
      document.querySelectorAll('textarea').forEach((ta: HTMLTextAreaElement) => {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
      });
    };
    const id = setTimeout(adjust, 50);
    window.addEventListener('resize', adjust);
    return () => { clearTimeout(id); window.removeEventListener('resize', adjust); };
  }, [currentView, structuredGoal, manualTasks, editingManualTaskIndex]);

  // ── Goal generation — single path for both voice and typed input ──────────
  const runGoalGeneration = async (
    input: { text: string } | { audioBase64: string; mimeType: string },
    isRefinement = false,
    idToken?: string,
  ) => {
    fetchAbortRef.current?.abort();
    const ac = new AbortController();
    fetchAbortRef.current = ac;
    setPhase('generating');
    setProcessingError(null);
    try {
      const token = idToken ?? await user.getIdToken();
      const structured = await generateGoal(input, token, {
        age: dbUser?.age,
        nationality: dbUser?.nationality,
        locality: dbUser?.locality,
      }, ac.signal);
      const primaryLang = structured.languages?.[0];
      if (primaryLang) {
        const code = mapLanguageNameToCode(primaryLang);
        if (code !== 'en') setLanguage(code);
      }
      setCurrentTranscript(structured.transcript || ('text' in input ? input.text : null));
      setStructuredGoal(structured);
      setCurrentView('review');
      if (isRefinement) {
        setRefinementCount(p => p + 1);
        setIsAddingDetails(false);
        setAdditionalDetails('');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') setProcessingError(err.message || 'Error');
    } finally {
      setPhase('idle');
    }
  };

  const processAudio = async (blob: Blob, isRefinement = false) => {
    fetchAbortRef.current?.abort();
    const ac = new AbortController();
    fetchAbortRef.current = ac;
    const reader = new FileReader();
    const b64 = await new Promise<string>((res) => {
      reader.onloadend = () => res((reader.result as string).split(',')[1]);
      reader.readAsDataURL(blob);
    });
    if (isRefinement && currentTranscript) {
      // Transcribe the new audio then append to existing transcript before regenerating
      setPhase('generating');
      setProcessingError(null);
      try {
        const idToken = await user.getIdToken();
        const newTranscript = await transcribeAudio(b64, blob.type, idToken, ac.signal);
        const combined = newTranscript
          ? `${currentTranscript}\n\nAdditional: ${newTranscript}`
          : currentTranscript;
        await runGoalGeneration({ text: combined }, true, idToken);
      } catch (err: any) {
        if (err.name !== 'AbortError') setProcessingError(err.message || 'Error transcribing audio');
        setPhase('idle');
      }
    } else {
      const idToken = await user.getIdToken();
      await runGoalGeneration({ audioBase64: b64, mimeType: blob.type }, false, idToken);
    }
  };

  const processTranscript = async (transcript: string, idToken?: string, isRefinement = false) => {
    await runGoalGeneration({ text: transcript }, isRefinement, idToken);
  };

  const handlePandaClick = async () => {
    if (isRecording) {
      const blob = await stopRecording();
      if (blob) processAudio(blob, isAddingDetails || currentView === 'review');
    } else {
      setProcessingError(null);
      await startRecording();
    }
  };

  const handleTypedGoalSubmit = async () => {
    if (!typedGoal.trim()) return;
    setCurrentTranscript(typedGoal.trim());
    const idToken = await user.getIdToken();
    await processTranscript(typedGoal.trim(), idToken);
    setTypedGoal('');
    setIsTyping(false);
  };

  const handleRegenerate = async () => {
    if (!currentTranscript) return;
    setIsEditingTranscript(false);
    const idToken = await user.getIdToken();
    await processTranscript(currentTranscript, idToken, true);
  };

  const handleAddDetailsSubmit = async () => {
    if (!additionalDetails.trim() || refinementCount >= REFINEMENT_LIMIT) return;
    const combined = `${currentTranscript}\n\nAdditional details: ${additionalDetails.trim()}`;
    setCurrentTranscript(combined);
    const idToken = await user.getIdToken();
    await processTranscript(combined, idToken, true);
  };

  const retryGeneration = async () => {
    if (!currentTranscript) return;
    const idToken = await user.getIdToken();
    await processTranscript(currentTranscript, idToken);
  };

  // ── Save goal ────────────────────────────────────────────────────────────
  const saveGoal = async () => {
    if (!user || !structuredGoal || phase !== 'idle') return;
    setPhase('saving');
    // B1: Date.now() collides when two goals are created in the same
    // millisecond. crypto.randomUUID() is collision-free for dedup purposes.
    const tempId    = `temp-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const optimistic: Goal = {
      id: tempId, ownerId: user.uid,
      title: structuredGoal.title, description: structuredGoal.description,
      category: structuredGoal.categories[0],
      // CLAUDE.md: Default visibility = public, only public/private allowed.
      visibility: structuredGoal.privacy === 'private' ? 'private' : 'public',
      progressPercent: 0, likesCount: 0, status: 'active', createdAt,
      savingStatus: 'saving', sourceText: structuredGoal.transcript,
      normalizedMatchingText: structuredGoal.normalizedMatchingText,
      timeHorizon: structuredGoal.timeHorizon, tags: structuredGoal.tags,
      matchingMetadata: { age: dbUser?.age ?? null, locality: dbUser?.locality ?? null },
      draftData: { structuredGoal, manualTasks },
    };
    addOptimisticGoal(optimistic);
    setCurrentView('home');
    try {
      await performSaveGoal(optimistic);
      setStructuredGoal(null);
      setManualTasks([]);
      setRefinementCount(0);
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setPhase('idle');
    }
  };

  const discardDraft = () => {
    setStructuredGoal(null); setManualTasks([]); setCurrentView('home');
    setRefinementCount(0); setIsAddingDetails(false); setAdditionalDetails('');
  };

  const toggleTaskSelection = (taskText: string) => {
    if (!structuredGoal) return;
    const has = structuredGoal.tasks.some(t => t.text === taskText);
    setStructuredGoal({ ...structuredGoal, tasks: has
      ? structuredGoal.tasks.filter(t => t.text !== taskText)
      : [...structuredGoal.tasks, { text: taskText, microSteps: [] }] });
  };

  const addManualTask = () => {
    if (newTaskInput.trim()) { setManualTasks(p => [...p, newTaskInput.trim()]); setNewTaskInput(''); }
  };
  const removeManualTask = (i: number) => setManualTasks(p => p.filter((_, j) => j !== i));

  // ── Derived ──────────────────────────────────────────────────────────────
  const firstName = dbUser?.displayName?.split(' ')[0] || user?.displayName?.split(' ')[0] || 'there';
  const avatarUrl = dbUser?.avatarUrl || user?.photoURL;

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--c-bg)' }}>
      <AnimatePresence mode="wait">

        {/* ── HOME VIEW ──────────────────────────────────────────────── */}
        {currentView === 'home' && (
          <motion.div key="home"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              height: isEditMode ? undefined : '100dvh',
              minHeight: isEditMode ? '100dvh' : undefined,
              display: 'flex',
              flexDirection: 'column',
              overflow: isEditMode ? 'auto' : 'hidden',
              paddingBottom: isEditMode ? 200 : 0,
            }}
          >
            {/* Header — never editable */}
            <div className="flex items-start justify-between px-5 pt-14 pb-2"
                 style={{ flexShrink: 0, position: 'relative', zIndex: 20 }}>
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1.2 }}>
                  {greeting()}, {firstName}
                </h1>
                <p className="text-meta mt-1" style={{ color: 'var(--c-text-3)' }}>
                  {motivational()}
                </p>
              </div>
              <button
                onClick={() => setCurrentScreen({ name: 'profile' })}
                className="flex-shrink-0 ml-4"
                style={{ marginTop: 2 }}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="avatar"
                    className="w-10 h-10 rounded-full object-cover"
                    style={{ border: '2px solid var(--c-border)' }} />
                ) : (
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                       style={{ background: 'var(--c-surface-2)', border: '2px solid var(--c-border)', color: 'var(--c-gold)' }}>
                    {firstName[0]?.toUpperCase()}
                  </div>
                )}
              </button>
            </div>

            {/* Content area — flex:1 fills remaining height; relative gives react-rnd its bounds */}
            <div style={{
              position: 'relative',
              flex: isEditMode ? undefined : 1,
              minHeight: isEditMode ? '60vh' : 0,
              overflow: 'hidden',
            }}>

              {/* Input widget — long-press 1.2s to enter edit mode */}
              <DraggableInputWidget>
                {/* POLISH: 48px min-height tap target, --r-lg (16) radius, focus-within
                    outline uses `outline` not box-shadow so it never shifts layout. */}
                <div className="flex items-center gap-3 px-4 rounded-2xl focus-within:outline"
                     style={{
                       background:    'var(--c-surface)',
                       border:        '1px solid var(--c-border)',
                       minHeight:     48,
                       borderRadius:  'var(--r-lg)',
                       outlineColor:  'var(--c-gold)',
                       outlineOffset: '2px',
                       outlineWidth:  '2px',
                     }}>
                  {!isTyping ? (
                    <button
                      onClick={() => setIsTyping(true)}
                      /* POLISH: full-row tap target for the "New goal…" affordance */
                      className="flex-1 text-left text-sm anim-press"
                      style={{ color: 'var(--c-text-3)', minHeight: 44 }}
                    >
                      New goal…
                    </button>
                  ) : (
                    <>
                      <input
                        autoFocus
                        type="text"
                        placeholder="Describe your goal…"
                        value={typedGoal}
                        onChange={(e) => setTypedGoal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleTypedGoalSubmit();
                          if (e.key === 'Escape') { setIsTyping(false); setTypedGoal(''); }
                        }}
                        className="flex-1 bg-transparent border-none outline-none text-sm"
                        style={{ color: 'var(--c-text)' }}
                      />
                      <button
                        onClick={handleTypedGoalSubmit}
                        disabled={!typedGoal.trim() || phase !== 'idle'}
                        className="flex-shrink-0 disabled:opacity-40 transition-opacity"
                        style={{ color: 'var(--c-gold)' }}
                      >
                        {phase !== 'idle' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      </button>
                      <button
                        onClick={() => { setIsTyping(false); setTypedGoal(''); }}
                        className="flex-shrink-0"
                        style={{ color: 'var(--c-text-3)' }}
                      >
                        <X size={15} />
                      </button>
                    </>
                  )}

                  {/* Panda tap-to-record button — enlarges on press, starts voice input */}
                  <motion.button
                    onClick={async () => { setProcessingError(null); setCurrentView('recording'); await startRecording(); }}
                    disabled={phase !== 'idle'}
                    aria-label="Record new goal"
                    className="group flex-shrink-0 flex items-center justify-center disabled:opacity-40 transition-opacity"
                    style={{ minWidth: 44, minHeight: 44 }}
                    whileTap={{ scale: 1.55 }}
                    animate={phase === 'idle' ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 18, repeat: phase === 'idle' ? Infinity : 0, repeatDelay: 3, duration: 1.4 }}
                  >
                    <PandaIcon size={28} active={false} />
                  </motion.button>
                </div>

                {(processingError || recorderError) && (
                  <p className="text-meta mt-2 px-1" style={{ color: '#e07070', fontSize: 12 }}>
                    {processingError || recorderError}
                  </p>
                )}
              </DraggableInputWidget>

              {/* Loading skeleton (normal mode only) */}
              {!isEditMode && goalsLoading && goals.length === 0 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between px-4 mb-3">
                    <div className="h-4 w-20 rounded-md animate-pulse" style={{ background: 'var(--c-surface-2)' }} />
                    <div className="h-3 w-10 rounded-md animate-pulse" style={{ background: 'var(--c-surface-2)' }} />
                  </div>
                  <div className="flex gap-3 overflow-hidden pl-4 pr-4">
                    <GoalCardSkeleton />
                    <GoalCardSkeleton />
                  </div>
                </div>
              )}

              {/* Normal mode — horizontal swipe carousel */}
              {!isEditMode && goals.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 16,        /* 16px from left edge */
                  right: 0,
                  bottom: 132,     /* leave room above the fixed input bar + nav */
                }}>
                  <GoalStackCarousel
                    goals={goals}
                    hasMore={hasMoreGoals}
                    onLoadMore={loadMoreGoals}
                    onOpen={goalId => setCurrentScreen({ name: 'goal-detail', goalId, initialTab: 'plan' })}
                  />
                </div>
              )}

              {/* Edit mode — free canvas */}
              {isEditMode && goals.length > 0 && (
                <EditableGoalCards
                  goals={goals}
                  onOpen={goalId => setCurrentScreen({ name: 'goal-detail', goalId, initialTab: 'plan' })}
                  renderCard={(goal, { fillContainer, onOpen, index }) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      onOpen={onOpen}
                      fillContainer={fillContainer}
                      index={index}               /* POLISH: stagger index */
                    />
                  )}
                />
              )}

              {/* Empty state */}
              {!isEditMode && !goalsLoading && goals.length === 0 && (
                <div className="px-4 mt-10 text-center">
                  <p className="text-body" style={{ color: 'var(--c-text-3)' }}>
                    Record your first goal using the bar below.
                  </p>
                </div>
              )}

            </div>{/* /editable area */}
          </motion.div>
        )}

        {/* ── RECORDING VIEW ─────────────────────────────────────────── */}
        {currentView === 'recording' && (
          <motion.div key="recording"
            /* POLISH: token-driven panel transition (duration 300ms, ease-out-quad) */
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: POL_DUR_PANEL, ease: POL_EASE }}
            className="flex flex-col items-center justify-center px-6"
            style={{ minHeight: '100dvh' }}
          >
            {/* POLISH: Panda container — 44 min-h tap ring baked into its own bounds,
                ambient radial glow behind it (transform-safe, doesn't repaint siblings
                because the recording view is paint-contained). */}
            <div
              className="relative"
              style={{ width: 224, height: 224, contain: 'layout style paint' }}
            >
              <div
                aria-hidden
                className={isRecording ? 'anim-gold-pulse' : ''}
                style={{
                  position:     'absolute',
                  inset:        -24,
                  borderRadius: '50%',
                  background:   'radial-gradient(circle, rgba(201,168,76,0.18) 0%, transparent 65%)',
                  pointerEvents:'none',
                }}
              />
              <Panda isListening={isRecording} onClick={handlePandaClick} className="w-56 h-56 relative" />
            </div>

            <div className="mt-8 text-center w-full max-w-sm">
              {phase !== 'idle' ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex items-center gap-3 px-5 py-3 rounded-2xl"
                       style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
                    <Loader2 size={16} className="animate-spin" style={{ color: 'var(--c-gold)' }} />
                    <span className="text-body" style={{ color: 'var(--c-text-2)' }}>
                      Generating your goal…
                    </span>
                  </div>
                  <button
                    onClick={() => { setPhase('idle'); setCurrentView('home'); }}
                    className="text-meta" style={{ color: 'var(--c-text-3)' }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-card-title" style={{ color: isRecording ? 'var(--c-gold)' : 'var(--c-text-2)' }}>
                    {isRecording ? 'Listening…' : 'Tap Panda to speak'}
                  </p>

                  {isRecording && (
                    /* POLISH: fixed height + scaleY — stays on the GPU compositor, no layout thrash */
                    <div className="flex gap-1 justify-center items-center mt-4" style={{ height: 22 }}>
                      {[1,2,3,4,5].map(i => (
                        <motion.div key={i}
                          animate={{ scaleY: [0.2, 1, 0.2] }}
                          transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1, ease: 'easeInOut' }}
                          style={{
                            width: 4,
                            height: 18,
                            background: 'var(--c-gold)',
                            borderRadius: 4,
                            transformOrigin: 'center',
                            willChange: 'transform',
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {!isRecording && (
                    <button
                      onClick={() => setCurrentView('home')}
                      className="mt-6 text-meta flex items-center gap-2 mx-auto"
                      style={{ color: 'var(--c-text-3)' }}
                    >
                      <ArrowLeft size={14} /> Back
                    </button>
                  )}
                </>
              )}

              {(processingError || recorderError) && (
                <div className="mt-6 flex flex-col items-center gap-3">
                  <p className="text-meta" style={{ color: '#e07070' }}>
                    {processingError || recorderError}
                  </p>
                  {processingError && currentTranscript && (
                    <button onClick={retryGeneration}
                      className="text-meta" style={{ color: 'var(--c-text-2)' }}>
                      Retry
                    </button>
                  )}
                  <button onClick={() => { setProcessingError(null); setCurrentView('home'); }}
                    className="text-meta" style={{ color: 'var(--c-text-3)' }}>
                    Go back
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── REVIEW VIEW (keep existing logic, updated style) ────────── */}
        {currentView === 'review' && structuredGoal && (
          <motion.div key="review"
            /* POLISH: token-driven panel transition */
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: POL_DUR_PANEL, ease: POL_EASE }}
            className="max-w-2xl mx-auto px-5 pt-14 pb-32"
          >
            {/* Nav */}
            <div className="flex items-center justify-between mb-8">
              <button onClick={() => setCurrentView('home')}
                className="flex items-center gap-2 text-body transition-opacity hover:opacity-70"
                style={{ color: 'var(--c-text-2)' }}>
                <ArrowLeft size={18} /> Back
              </button>
              <button onClick={discardDraft}
                className="text-meta transition-opacity hover:opacity-70"
                style={{ color: '#e07070' }}>
                Discard
              </button>
            </div>

            <div className="space-y-8">
              {/* Transcript */}
              <div className="p-5 rounded-2xl space-y-3"
                   style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-meta uppercase tracking-widest"
                        style={{ color: 'var(--c-text-3)', letterSpacing: '0.12em' }}>
                    {t('transcript')}
                  </span>
                  <button onClick={() => isEditingTranscript ? handleRegenerate() : setIsEditingTranscript(true)}
                    disabled={phase !== 'idle'}
                    className="text-meta transition-opacity hover:opacity-70"
                    style={{ color: isEditingTranscript ? 'var(--c-gold)' : 'var(--c-text-3)' }}>
                    {isEditingTranscript ? 'Regenerate ↺' : <Edit2 size={13} />}
                  </button>
                </div>
                <textarea
                  readOnly={!isEditingTranscript}
                  value={currentTranscript || ''}
                  onChange={(e) => { setCurrentTranscript(e.target.value); e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px'; }}
                  className="w-full bg-transparent border-none focus:ring-0 p-0 text-sm italic leading-relaxed resize-none overflow-hidden"
                  style={{ color: isEditingTranscript ? 'var(--c-text)' : 'var(--c-text-2)' }}
                />
                {!isAddingDetails && refinementCount < REFINEMENT_LIMIT && (
                  <button onClick={() => setIsAddingDetails(true)}
                    className="text-meta flex items-center gap-1.5"
                    style={{ color: 'var(--c-text-3)' }}>
                    <Plus size={12} /> Add more details
                  </button>
                )}
                <AnimatePresence>
                  {isAddingDetails && (
                    <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }}
                      exit={{ opacity:0, height:0 }} className="overflow-hidden pt-3 space-y-3"
                      style={{ borderTop: '1px solid var(--c-border)' }}>
                      <div className="relative">
                        <textarea autoFocus
                          placeholder={t('typeAdditionalDetails')}
                          value={additionalDetails}
                          onChange={(e) => { setAdditionalDetails(e.target.value); e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px'; }}
                          className="w-full rounded-xl p-3 pr-12 text-sm focus:outline-none resize-none overflow-hidden"
                          style={{ background:'var(--c-surface-2)', border:'1px solid var(--c-border)', color:'var(--c-text)', minHeight:60 }}
                        />
                        {additionalDetails.trim() && (
                          <button onClick={handleAddDetailsSubmit} disabled={phase !== 'idle'}
                            className="absolute bottom-2.5 right-2.5 p-2 rounded-xl disabled:opacity-40"
                            style={{ background:'var(--c-gold)', color:'#000' }}>
                            {phase !== 'idle' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                          </button>
                        )}
                      </div>
                      <button onClick={() => { setIsAddingDetails(false); setAdditionalDetails(''); }}
                        className="text-meta" style={{ color:'var(--c-text-3)' }}>
                        Cancel
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Title */}
              <div>
                <label className="text-meta uppercase tracking-widest block mb-2"
                       style={{ color:'var(--c-text-3)', letterSpacing:'0.12em' }}>
                  {t('reviewGoal')}
                </label>
                <textarea value={structuredGoal.title} rows={1}
                  onChange={(e) => { setStructuredGoal({...structuredGoal, title:e.target.value}); e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px'; }}
                  className="text-3xl font-bold bg-transparent border-none focus:ring-0 w-full p-0 tracking-tight resize-none overflow-hidden"
                  style={{ color:'var(--c-text)' }}
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-meta uppercase tracking-widest block mb-2"
                       style={{ color:'var(--c-text-3)', letterSpacing:'0.12em' }}>
                  {t('goalDescription')}
                </label>
                <textarea value={structuredGoal.description}
                  onChange={(e) => { setStructuredGoal({...structuredGoal, description:e.target.value}); e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px'; }}
                  className="text-lg bg-transparent border-none focus:ring-0 w-full p-0 leading-relaxed resize-none overflow-hidden"
                  style={{ color:'var(--c-text-2)', minHeight:'5rem' }}
                />
              </div>

              {/* Tasks */}
              <div>
                <label className="text-meta uppercase tracking-widest block mb-3"
                       style={{ color:'var(--c-text-3)', letterSpacing:'0.12em' }}>
                  {t('suggestedTasks')}
                </label>
                <div className="space-y-2">
                  {structuredGoal.tasks.map((task, i) => (
                    <div key={i} className="rounded-xl overflow-hidden"
                         style={{ background:'var(--c-surface)', border:'1px solid var(--c-border)' }}>
                      <div className="flex items-start gap-3 p-4">
                        <div onClick={() => toggleTaskSelection(task.text)}
                          className="w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 cursor-pointer mt-0.5"
                          style={{ borderColor:'var(--c-success)', background:'rgba(74,124,89,.15)' }}>
                          <Check size={11} style={{ color:'var(--c-success)' }} />
                        </div>
                        <textarea value={task.text} rows={1}
                          onChange={(e) => { const updated=[...structuredGoal.tasks]; updated[i]={...updated[i],text:e.target.value}; setStructuredGoal({...structuredGoal,tasks:updated}); e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px'; }}
                          className="flex-1 bg-transparent border-none focus:ring-0 p-0 text-sm resize-none overflow-hidden font-medium"
                          style={{ color:'var(--c-text)' }}
                        />
                        <button onClick={() => setStructuredGoal({...structuredGoal, tasks:structuredGoal.tasks.filter((_,j)=>j!==i)})}
                          style={{ color:'var(--c-text-3)' }} className="hover:opacity-70 mt-0.5">
                          <X size={13} />
                        </button>
                      </div>
                      {task.microSteps.length > 0 && (
                        <div className="px-4 pb-3 space-y-1">
                          {task.microSteps.map((step, si) => (
                            <div key={si} className="flex items-start gap-2 pl-8">
                              <span className="text-xs mt-0.5 flex-shrink-0" style={{ color:'var(--c-text-3)' }}>›</span>
                              <span className="text-xs" style={{ color:'var(--c-text-3)' }}>{step}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Manual tasks */}
                {manualTasks.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {manualTasks.map((task, i) => (
                      <div key={i} className="flex items-center gap-3 p-4 rounded-xl group"
                           style={{ background:'var(--c-surface)', border:'1px solid var(--c-border)' }}>
                        <div className="w-5 h-5 rounded-full border flex-shrink-0"
                             style={{ borderColor:'var(--c-success)', background:'rgba(74,124,89,.15)' }} />
                        <span className="flex-1 text-sm" style={{ color:'var(--c-text)' }}>{task}</span>
                        <button onClick={() => removeManualTask(i)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color:'var(--c-text-3)' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mt-3">
                  <input placeholder="Add a task…" value={newTaskInput}
                    onChange={(e) => setNewTaskInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key==='Enter') { e.preventDefault(); addManualTask(); } }}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm focus:outline-none"
                    style={{ background:'var(--c-surface-2)', border:'1px solid var(--c-border)', color:'var(--c-text)' }}
                  />
                  <button onClick={addManualTask}
                    className="p-2.5 rounded-xl transition-opacity hover:opacity-80"
                    style={{ background:'var(--c-surface-2)', border:'1px solid var(--c-border)' }}>
                    <Plus size={18} style={{ color:'var(--c-text-2)' }} />
                  </button>
                </div>
              </div>

              {/* Category + time + privacy */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-meta uppercase tracking-widest block mb-2"
                         style={{ color:'var(--c-text-3)', letterSpacing:'0.12em' }}>
                    {t('category')}
                  </label>
                  <select value={structuredGoal.categories[0] ?? ''}
                    onChange={(e) => setStructuredGoal({...structuredGoal, categories:[e.target.value, ...structuredGoal.categories.slice(1)]})}
                    className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
                    style={{ background:'var(--c-surface-2)', border:'1px solid var(--c-border)', color:'var(--c-text)' }}>
                    {GOAL_CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-meta uppercase tracking-widest block mb-2"
                         style={{ color:'var(--c-text-3)', letterSpacing:'0.12em' }}>
                    {t('privacy')}
                  </label>
                  {/* POLISH: segmented toggle — 44 min-height, anim-press pulse on the
                      selected side, aria-pressed for assistive tech, ease-out colour swap. */}
                  <div className="flex rounded-xl overflow-hidden"
                       style={{
                         border:       '1px solid var(--c-border)',
                         background:   'var(--c-surface-2)',
                         borderRadius: 'var(--r-md)',
                       }}>
                    {(['public','private'] as const).map(v => {
                      const on = structuredGoal.privacy === v;
                      return (
                        <button
                          key={v}
                          onClick={() => setStructuredGoal({...structuredGoal, privacy:v})}
                          aria-pressed={on}
                          className="anim-press flex-1 text-xs font-semibold capitalize"
                          style={{
                            minHeight:  44,
                            background: on ? 'var(--c-gold)' : 'transparent',
                            color:      on ? '#000'         : 'var(--c-text-3)',
                            transition: 'background-color var(--dur-micro) var(--ease-out-quad), color var(--dur-micro) var(--ease-out-quad)',
                          }}
                        >
                          {t(v)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="text-meta uppercase tracking-widest block mb-2"
                       style={{ color:'var(--c-text-3)', letterSpacing:'0.12em' }}>
                  {t('tags')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {structuredGoal.tags.map((tag, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
                         style={{ background:'var(--c-surface-2)', border:'1px solid var(--c-border)', color:'var(--c-text-2)' }}>
                      #{tag}
                      <button onClick={() => setStructuredGoal({...structuredGoal, tags:structuredGoal.tags.filter((_,j)=>j!==i)})}
                        style={{ color:'var(--c-text-3)' }}>
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  <input placeholder="+ tag" className="bg-transparent border-none focus:ring-0 text-xs w-16"
                    style={{ color:'var(--c-text-3)' }}
                    onKeyDown={(e) => {
                      if (e.key==='Enter') {
                        const val=(e.target as HTMLInputElement).value.trim().replace('#','');
                        if (val) { setStructuredGoal({...structuredGoal, tags:[...structuredGoal.tags, val]}); (e.target as HTMLInputElement).value=''; }
                      }
                    }} />
                </div>
              </div>

              {/* Save button */}
              <button onClick={saveGoal} disabled={phase === 'saving'}
                className="btn-gold w-full flex items-center justify-center gap-2 mt-4">
                {phase === 'saving' ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                {phase === 'saving' ? t('saving') : t('saveGoal')}
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}