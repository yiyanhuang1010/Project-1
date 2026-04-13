const geminiKeyInput = document.getElementById("gemini-key");
const anthropicKeyInput = document.getElementById("anthropic-key");
const saveBtn = document.getElementById("save");
const msg = document.getElementById("msg");

chrome.storage.sync.get(["geminiApiKey", "anthropicApiKey"], (data) => {
  if (data.geminiApiKey) geminiKeyInput.value = data.geminiApiKey;
  if (data.anthropicApiKey) anthropicKeyInput.value = data.anthropicApiKey;
});

saveBtn.addEventListener("click", () => {
  const geminiApiKey = geminiKeyInput.value.trim();
  const anthropicApiKey = anthropicKeyInput.value.trim();
  chrome.storage.sync.set({ geminiApiKey, anthropicApiKey }, () => {
    msg.textContent = "Saved.";
    setTimeout(() => {
      msg.textContent = "";
    }, 2500);
  });
});
