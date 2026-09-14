//! A multi-user CLI chatbot on Twigg. Rust 1.85+, two dependencies (ureq, serde_json).
//!
//!   cargo run   (reads TWIGG_API_KEY from the environment, a .env, or asks)
//!
//! This app stores nothing. Twigg keeps every chat and message, and each user's
//! chats live under the namespace twigg-demo/<user>, so listing a user's chats
//! is one API call. Type a message to chat, or a command:
//!
//!   /user <name>   switch user (starts a fresh chat)
//!   /new           start a fresh chat
//!   /list          list this user's chats
//!   /open <n>      reopen chat <n> from the last /list and show its history
//!   /model [n]     list the models, or switch to model <n> from that list
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

struct App {
    agent: ureq::Agent,
    api: String,
    model: String, // named on every message, so it can change mid-chat
    key: String,
    user: String,
    chat: Option<String>, // the open chat's id: the only state this app holds
    listed: Vec<Value>,
    models: Vec<Value>,
}

fn main() {
    // ./.env, if there is one; variables already set win
    let dotenv: HashMap<String, String> = std::fs::read_to_string(".env")
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.trim().split_once('='))
        .filter(|(name, _)| !name.starts_with('#'))
        .map(|(name, value)| (name.trim().into(), value.trim().trim_matches(['"', '\'']).into()))
        .collect();
    let var = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty()).or_else(|| dotenv.get(name).cloned());

    let mut app = App {
        agent: ureq::Agent::config_builder().http_status_as_error(false).build().into(),
        api: var("TWIGG_BASE_URL").unwrap_or("https://api.twigg.ai".into()) + "/api/v1",
        model: var("TWIGG_MODEL").unwrap_or("gpt-5-6-luna".into()),
        key: var("TWIGG_API_KEY").or_else(|| prompt("Twigg API key: ")).unwrap_or_default(),
        user: "guest".into(),
        chat: None,
        listed: vec![],
        models: vec![],
    };
    println!("Type a message, or /user <name>, /new, /list, /open <n>, /model [n].");
    while let Some(line) = prompt(&format!("{}> ", app.user)) {
        if let Err(err) = app.run(&line) {
            eprintln!("{err}");
        }
    }
}

impl App {
    fn run(&mut self, line: &str) -> Result<()> {
        let mut words = line.split_whitespace();
        let (command, arg) = (words.next().unwrap_or_default(), words.next().unwrap_or_default());
        match command {
            "" => {}
            _ if !line.starts_with('/') => self.send(line)?,
            "/user" => {
                self.user = if arg.is_empty() { "guest" } else { arg }.into();
                self.chat = None;
                self.listed.clear();
            }
            "/new" => self.chat = None,
            "/list" => {
                let page = self.json(&format!("/chats?namespace=twigg-demo%2F{}", self.user), None)?;
                self.listed = page["data"].as_array().cloned().unwrap_or_default();
                for (i, chat) in self.listed.iter().enumerate() {
                    let updated = chat["updated_at"].as_str().unwrap_or_default();
                    let title = chat["title"].as_str().unwrap_or("Untitled");
                    println!("{}. {title}  ({})", i + 1, &updated[..updated.len().min(16)]);
                }
            }
            "/open" => {
                let picked = arg.parse::<usize>().ok().and_then(|n| self.listed.get(n.checked_sub(1)?));
                let Some(chat) = picked.and_then(|c| c["id"].as_str()).map(String::from) else {
                    println!("Run /list, then /open <n>");
                    return Ok(());
                };
                self.chat = Some(chat.clone());
                let history = self.json(&format!("/chats/{chat}/history?limit=100"), None)?;
                for part in history["data"].as_array().into_iter().flatten() {
                    if part["part"]["type"] == "prompt" || part["part"]["type"] == "message" {
                        let who = if part["role"] == "user" { "you" } else { "bot" };
                        println!("{who}: {}\n", part["part"]["text"].as_str().unwrap_or_default());
                    }
                }
            }
            "/model" if arg.is_empty() => {
                self.models = self.json("/models", None)?.as_array().cloned().unwrap_or_default();
                for (i, m) in self.models.iter().enumerate() {
                    let current = if m["name"] == self.model.as_str() { "  (current)" } else { "" };
                    let (name, provider) = (m["name"].as_str().unwrap_or_default(), m["provider_label"].as_str().unwrap_or_default());
                    println!("{}. {name}  {provider}{current}", i + 1);
                }
            }
            "/model" => {
                let picked = arg.parse::<usize>().ok().and_then(|n| self.models.get(n.checked_sub(1)?));
                let Some(name) = picked.and_then(|m| m["name"].as_str()).map(String::from) else {
                    println!("Run /model, then /model <n>");
                    return Ok(());
                };
                println!("Using {name}");
                self.model = name;
            }
            _ => println!("Commands: /user <name>, /new, /list, /open <n>, /model [n]"),
        }
        Ok(())
    }

    /// Send only the new message. Twigg adds it to the chat, builds the context and streams the reply.
    fn send(&mut self, text: &str) -> Result<()> {
        if self.chat.is_none() {
            let title: String = text.chars().take(50).collect();
            let created = self.json("/chats", Some(json!({"namespace": format!("twigg-demo/{}", self.user), "title": title})))?;
            self.chat = created["id"].as_str().map(String::from);
        }
        let path = format!("/chats/{}/responses", self.chat.as_deref().unwrap_or_default());
        let stream = self.twigg(&path, Some(json!({"model": self.model, "input": [{"type": "prompt", "text": text}]})))?;
        let mut event = String::new();
        for line in BufReader::new(stream.into_reader()).lines() {
            let line = line?;
            if let Some(name) = line.strip_prefix("event:") {
                event = name.trim().into();
            }
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data: Value = serde_json::from_str(data)?;
            if event == "delta" && data["kind"] == "text" {
                print!("{}", data["text"].as_str().unwrap_or_default());
                io::stdout().flush()?;
            }
            if event == "error" {
                return Err(data["message"].as_str().unwrap_or("stream failed").into());
            }
        }
        println!("\n");
        Ok(())
    }

    /// Call the API and hand back the body: a stream for /responses, JSON everywhere else.
    fn twigg(&self, path: &str, body: Option<Value>) -> Result<ureq::Body> {
        let (url, auth) = (format!("{}{path}", self.api), format!("Bearer {}", self.key));
        let res = match body {
            Some(body) => self.agent.post(&url).header("Authorization", &auth).content_type("application/json").send(body.to_string())?,
            None => self.agent.get(&url).header("Authorization", &auth).call()?,
        };
        let status = res.status();
        let mut body = res.into_body();
        if !status.is_success() {
            return Err(format!("Twigg {}: {}", status.as_u16(), body.read_to_string()?).into());
        }
        Ok(body)
    }

    fn json(&self, path: &str, body: Option<Value>) -> Result<Value> {
        Ok(serde_json::from_str(&self.twigg(path, body)?.read_to_string()?)?)
    }
}

fn prompt(label: &str) -> Option<String> {
    print!("{label}");
    io::stdout().flush().ok()?;
    let mut line = String::new();
    (io::stdin().read_line(&mut line).ok()? > 0).then(|| line.trim().to_string())
}
