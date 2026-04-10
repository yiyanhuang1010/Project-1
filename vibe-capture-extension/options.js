const keyInput = document.getElementById("key");
const saveBtn = document.getElementById("save");
const msg = document.getElementById("msg");

chrome.storage.sync.get(["geminiApiKey"], (data) => {
  if (data.geminiApiKey) keyInput.value = data.geminiApiKey;
});

saveBtn.addEventListener("click", () => {
  const geminiApiKey = keyInput.value.trim();
  chrome.storage.sync.set({ geminiApiKey }, () => {
    msg.textContent = "Saved.";
    setTimeout(() => {
      msg.textContent = "";
    }, 2500);
  });
});
