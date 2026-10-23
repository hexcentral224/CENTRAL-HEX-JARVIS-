const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const app = express(); app.disable("x-powered-by"); app.use(express.json({limit:"32kb"}));
const port = Number(process.env.PORT || 3000), apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map(x=>x.trim()).filter(Boolean);
app.use(cors({origin(origin,cb){if(!origin || allowed.length===0 || allowed.includes(origin)) return cb(null,true); return cb(new Error("Origine non autorisée"));},methods:["GET","POST"],allowedHeaders:["Content-Type"]}));
const client = apiKey ? new OpenAI({apiKey}) : null;
app.get("/",(_req,res)=>res.json({name:"CENTRAL-HEX JARVIS API",status:"online",configured:Boolean(client),endpoints:["/health","/api/chat"]}));
app.get("/health",(_req,res)=>res.json({status:"ok",configured:Boolean(client),model}));
app.post("/api/chat",async(req,res)=>{try{
 if(!client)return res.status(503).json({error:"Clé API absente : ajoute OPENAI_API_KEY dans les variables Render."});
 const message=typeof req.body?.message==="string"?req.body.message.trim().slice(0,4000):""; if(!message)return res.status(400).json({error:"Le champ message est obligatoire."});
 const history=Array.isArray(req.body?.history)?req.body.history.slice(-10):[];
 const safe=history.filter(x=>x&&["user","assistant"].includes(x.role)&&typeof x.content==="string").map(x=>({role:x.role,content:x.content.slice(0,4000)}));
 const result=await client.chat.completions.create({model,messages:[{role:"system",content:"Tu es JARVIS, un assistant utile et prudent intégré à CENTRAL-HEX. Réponds en français si l'utilisateur écrit en français. Ne prétends pas avoir effectué une action sur l'appareil si ce n'est pas le cas."},...safe,{role:"user",content:message}],temperature:0.7,max_tokens:700});
 const reply=result.choices?.[0]?.message?.content?.trim(); if(!reply)return res.status(502).json({error:"Le modèle n'a pas renvoyé de texte."}); res.json({reply,model});
 }catch(e){console.error("Chat API error:",e?.status||"",e?.message||"unknown");if(e?.status===401)return res.status(502).json({error:"Clé API refusée. Vérifie OPENAI_API_KEY sur Render."});if(e?.status===429)return res.status(429).json({error:"Quota ou limite API atteinte. Vérifie la facturation API."});res.status(500).json({error:"Erreur du fournisseur IA. Vérifie les journaux Render."});}});
app.listen(port,"0.0.0.0",()=>console.log(`CENTRAL-HEX API écoute sur ${port}`));
