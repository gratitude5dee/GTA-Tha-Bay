// Vite `?raw` imports used by the config checks of the account tests (AC-6, AC-7).
declare module '*?raw' {
  const text: string;
  export default text;
}
