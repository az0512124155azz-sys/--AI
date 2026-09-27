(function(){"use strict";
const $=id=>document.getElementById(id);
const PROVIDERS={
gemini:{label:"Gemini",models:[
{id:"gemini-3.8-flash",name:"3.8 Flash"},
{id:"gemini-3.5-flash-lite",name:"3.5 Flash-Lite"},
{id:"gemini-3.5-flash",name:"3.5 Flash"},
{id:"gemini-3.7-flash",name:"3.7 Flash"}
]},
openrouter:{label:"OpenRouter",models:[
{id:"openrouter/free",name:"Free Router"},
{id:"qwen/qwen3.8-27b:free",name:"Qwen3.8 27B"},
{id:"google/gemma-4-31b-it:free",name:"Gemma 4 31B"},
{id:"meta-llama/llama-3.3-70b-instruct:free",name:"Llama 3.3 70B"},
{id:"nvidia/nemotron-3-super-120b-a12b:free",name:"Nemotron 3 Super"}
]},
chatgpt:{label:"ChatGPT",models:[
{id:"auto",name:"Auto"},
{id:"gpt-4o",name:"GPT-4o"},
{id:"o3-mini",name:"o3-mini"},
{id:"gpt-4.1",name:"GPT-4.1"}
]}
};
const STALE=/gemini-2\.|gemini-1\./;
let busy=false,files=[],conversation=[],streamPort=null,uiTimer=null;
const input=$("input"),send=$("btnSend"),msgs=$("msgs");
function esc(s){return String(s).replace(/&/g,"&").replace(/</g,"<").replace(/>/g,">").replace(/\n/g,"<br>")}
function syncModels(){
  const p=$("provider").value;
  const list=PROVIDERS[p].models;
  $("model").innerHTML=list.map(m=>`<option value="${m.id}">${m.name}</option>`).join("");
  input.placeholder="שאל את "+PROVIDERS[p].label;
  if(p==="gemini") $("model").value="gemini-3.8-flash";
}
function grow(){input.style.height="auto";input.style.height=Math.min(input.scrollHeight,140)+"px"}
function canSend(){if(send)send.disabled=!input.value.trim()&&!busy}
function showThread(){if($("home"))$("home").style.display="none";if($("sugs"))$("sugs").style.display="none";if(msgs)msgs.classList.add("on")}
function stopStream(){try{if(streamPort)streamPort.disconnect()}catch(_){}streamPort=null;if(uiTimer){clearTimeout(uiTimer);uiTimer=null}}
function reset(){stopStream();busy=false;setSend(false);conversation=[];if(msgs){msgs.innerHTML="";msgs.classList.remove("on")}if($("home"))$("home").style.display="";if($("sugs"))$("sugs").style.display="";files=[];drawFiles();canSend()}
function setSend(stop){if(!send)return;if(stop){send.classList.add("stop");send.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';send.disabled=false;send.title="עצור"}else{send.classList.remove("stop");send.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';send.title="שלח";canSend()}}
function addUser(t){showThread();const d=document.createElement("div");d.className="msg user";d.innerHTML='<div class="bubble">'+esc(t)+"</div>";msgs.appendChild(d);$("scroll").scrollTop=$("scroll").scrollHeight}
function addBot(){const d=document.createElement("div");d.className="msg bot";const n=PROVIDERS[$("provider").value].label;d.innerHTML='<div class="who"><svg viewBox="0 0 24 24"><path fill="#4285F4" d="M12 2l1.4 5.8L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.2L12 2z"/></svg>'+n+'</div><div class="text"><span class="dots"><span></span><span></span><span></span></span></div>';msgs.appendChild(d);$("scroll").scrollTop=$("scroll").scrollHeight;return d.querySelector(".text")}
function doSend(){
  const t=input.value.trim();
  if(!t||busy)return;
  addUser(t);
  input.value="";
  grow();
  busy=true;
  setSend(true);
  conversation.push({role:"user",content:t});
  const el=addBot();
  let full="";
  const provider=$("provider").value;
  let model=$("model").value;
  if(provider==="gemini"&&STALE.test(model)){model="gemini-3.8-flash";$("model").value=model}
  // UI hard timeout (ChatGPT can hang)
  const limit=provider==="chatgpt"?65000:90000;
  uiTimer=setTimeout(()=>{
    if(!busy)return;
    stopStream();
    busy=false;
    setSend(false);
    if(!full)el.innerHTML=esc("פג הזמן. אם ChatGPT – ודא שהטאב chatgpt.com פתוח ומחובר, ואז נסה שוב.");
  },limit);
  try{
    streamPort=chrome.runtime.connect({name:"stream"});
    streamPort.onMessage.addListener(msg=>{
      if(msg.type==="CHUNK"){
        full+=msg.text||"";
        el.innerHTML=esc(full);
        $("scroll").scrollTop=$("scroll").scrollHeight;
      }else if(msg.type==="DONE"){
        if(uiTimer){clearTimeout(uiTimer);uiTimer=null}
        conversation.push({role:"assistant",content:full});
        busy=false;
        setSend(false);
        stopStream();
      }else if(msg.type==="ERROR"){
        if(uiTimer){clearTimeout(uiTimer);uiTimer=null}
        el.innerHTML=esc(msg.error||"שגיאה");
        busy=false;
        setSend(false);
        stopStream();
      }
    });
    streamPort.onDisconnect.addListener(()=>{
      if(busy){
        busy=false;
        setSend(false);
        if(uiTimer){clearTimeout(uiTimer);uiTimer=null}
        if(!full)el.innerHTML=esc("החיבור נותק");
      }
    });
    streamPort.postMessage({type:"CHAT",provider,model,messages:conversation,withPage:provider!=="chatgpt",requestId:"r"+Date.now()});
  }catch(e){
    if(uiTimer){clearTimeout(uiTimer);uiTimer=null}
    el.innerHTML=esc("שגיאה: "+(e.message||e));
    busy=false;
    setSend(false);
  }
}
function stop(){stopStream();busy=false;setSend(false)}
function drawFiles(){const box=$("atts");if(!box)return;if(!files.length){box.classList.remove("on");box.innerHTML="";return}box.classList.add("on");box.innerHTML=files.map((n,i)=>'<span class="chip">'+esc(n)+'<button type="button" data-i="'+i+'">×</button></span>').join("");box.querySelectorAll("button").forEach(b=>{b.onclick=()=>{files.splice(+b.getAttribute("data-i"),1);drawFiles()}})}
async function loadSettings(){try{const s=await chrome.storage.local.get(["geminiKey","openrouterKey","systemPrompt","provider","model"]);if(s.geminiKey&&$("kG"))$("kG").value=s.geminiKey;if(s.openrouterKey&&$("kO"))$("kO").value=s.openrouterKey;if(s.systemPrompt&&$("sys"))$("sys").value=s.systemPrompt;if(s.provider&&$("provider"))$("provider").value=s.provider;syncModels();if(s.model&&!STALE.test(s.model)){const opts=[...$("model").options].map(o=>o.value);if(opts.includes(s.model))$("model").value=s.model}else if($("provider").value==="gemini"){$("model").value="gemini-3.8-flash";chrome.storage.local.set({model:"gemini-3.8-flash"})}}catch(_){syncModels()}}
async function saveSettings(){await chrome.storage.local.set({geminiKey:($("kG")&&$("kG").value)||"",openrouterKey:($("kO")&&$("kO").value)||"",systemPrompt:($("sys")&&$("sys").value)||"",provider:$("provider").value,model:$("model").value});$("sheet").classList.remove("open")}
function openChatGPTLogin(){chrome.tabs.create({url:"https://chatgpt.com/"})}
$("provider").onchange=()=>{syncModels();chrome.storage.local.set({provider:$("provider").value,model:$("model").value})};
input.oninput=()=>{grow();canSend()};
input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(!busy)doSend()}};
send.onclick=()=>busy?stop():doSend();
$("btnNew").onclick=reset;
$("btnSet").onclick=()=>$("sheet").classList.add("open");
$("btnClose").onclick=()=>$("sheet").classList.remove("open");
$("btnCancel").onclick=()=>$("sheet").classList.remove("open");
$("btnSave").onclick=saveSettings;
if($("btnCgptLogin"))$("btnCgptLogin").onclick=openChatGPTLogin;
$("btnAtt").onclick=()=>$("fileIn").click();
$("fileIn").onchange=e=>{Array.prototype.forEach.call(e.target.files||[],f=>files.push(f.name));drawFiles();e.target.value=""};
$("sugs").querySelectorAll("button").forEach(b=>{b.onclick=()=>{input.value=b.getAttribute("data-q");grow();canSend();doSend()}});
syncModels();canSend();loadSettings();
})();
