/** The dialogue panel (M06a5): `DialogueBubble`, its cards and choices, and the session that feeds them from `NpcRuntime`. */
export { DialogueBubble, DialoguePanel, showsReport } from './DialogueBubble.tsx';
export type { DialogueActions } from './DialogueBubble.tsx';
export { IntentChoices } from './IntentChoices.tsx';
export { LikenessCard, likenessText } from './LikenessCard.tsx';
export type { LikenessDisclaimer } from './LikenessCard.tsx';
export { SafetyCard } from './SafetyCard.tsx';
export {
  DialogueSession, DIALOGUE_OPEN_KEY, INTENTS, TEXT_MAX, CLOSE_HOLD_MIN_MS, SUBTITLE_MIN_MS, SUBTITLE_MS_PER_CHAR,
  bindDialogueOpen, dialogueBack, getDialogueSession, onDialogueSession, setDialogueSession,
} from './session.ts';
export type {
  Disclaimer, DialogueCard, DialogueChoice, DialogueOpenValue, DialogueRuntimePort, DialogueSessionOptions, DialogueTurnRef, DialogueView,
  PanelIntent, SpeakerInfo, SubtitleCue, TimerPort,
} from './session.ts';
export { AUDIO_GRACE_MS, LineReveal, SPEECH_WORDS_PER_S, TIMER_WORD_MS, audioWords, firstWords, timerWords, wordCount, wordTokens } from './reveal.ts';
export type { AudioClockPort, AudioLineClock, RevealFrame, RevealMode, RevealOptions } from './reveal.ts';
export {
  DIALOGUE_REPORT_CATEGORIES, chatTurnId, dialogueCapabilities, reportRequest, setDialogueCapabilities,
} from './capabilities.ts';
export type { DialogueCapabilities, DialogueReportClient, ReportCategory, ReportReq } from './capabilities.ts';
