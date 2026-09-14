// A multi-user CLI chatbot on Twigg. One file, Go 1.22+, standard library only.
//
//	go run twigg-chat.go   (reads TWIGG_API_KEY from the environment, a .env, or asks)
//
// This app stores nothing. Twigg keeps every chat and message, and each user's
// chats live under the namespace twigg-demo/<user>, so listing a user's chats
// is one API call. Type a message to chat, or a command:
//
//	/user <name>   switch user (starts a fresh chat)
//	/new           start a fresh chat
//	/list          list this user's chats
//	/open <n>      reopen chat <n> from the last /list and show its history
//	/model [n]     list the models, or switch to model <n> from that list
package main

import (
	"bufio"
	"bytes"
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type chatSummary struct {
	ID        string
	Title     string
	UpdatedAt string `json:"updated_at"`
}

type modelSummary struct {
	Name          string
	ProviderLabel string `json:"provider_label"`
}

var (
	api, key string
	model    string // named on every message, so it can change mid-chat
	user     = "guest"
	chat     string // the open chat's id: the only state this app holds
	listed   []chatSummary
	models   []modelSummary
	stdin    = bufio.NewScanner(os.Stdin)
)

func main() {
	loadEnv(".env")
	api = cmp.Or(os.Getenv("TWIGG_BASE_URL"), "https://api.twigg.ai") + "/api/v1"
	model = cmp.Or(os.Getenv("TWIGG_MODEL"), "gpt-5-6-luna")
	if key = os.Getenv("TWIGG_API_KEY"); key == "" {
		key, _ = prompt("Twigg API key: ")
	}
	fmt.Println("Type a message, or /user <name>, /new, /list, /open <n>, /model [n].")
	for {
		line, ok := prompt(user + "> ")
		if !ok {
			return
		}
		if err := run(line); err != nil {
			fmt.Fprintln(os.Stderr, err)
		}
	}
}

func run(line string) error {
	words := append(strings.Fields(line), "", "")
	command, arg := words[0], words[1]
	switch {
	case line == "":
	case !strings.HasPrefix(line, "/"):
		return send(line)
	case command == "/user":
		user, chat, listed = cmp.Or(arg, "guest"), "", nil
	case command == "/new":
		chat = ""
	case command == "/list":
		var page struct{ Data []chatSummary }
		if _, err := twigg("/chats?namespace="+url.QueryEscape("twigg-demo/"+user), nil, &page); err != nil {
			return err
		}
		listed = page.Data
		for i, c := range listed {
			fmt.Printf("%d. %s  (%s)\n", i+1, cmp.Or(c.Title, "Untitled"), c.UpdatedAt[:16])
		}
	case command == "/open":
		n, _ := strconv.Atoi(arg)
		if n < 1 || n > len(listed) {
			fmt.Println("Run /list, then /open <n>")
			return nil
		}
		chat = listed[n-1].ID
		var history struct {
			Data []struct {
				Role string
				Part struct{ Type, Text string }
			}
		}
		if _, err := twigg("/chats/"+chat+"/history?limit=100", nil, &history); err != nil {
			return err
		}
		for _, p := range history.Data {
			if p.Part.Type == "prompt" || p.Part.Type == "message" {
				who := "bot"
				if p.Role == "user" {
					who = "you"
				}
				fmt.Printf("%s: %s\n\n", who, p.Part.Text)
			}
		}
	case command == "/model" && arg == "":
		if _, err := twigg("/models", nil, &models); err != nil {
			return err
		}
		for i, m := range models {
			current := ""
			if m.Name == model {
				current = "  (current)"
			}
			fmt.Printf("%d. %s  %s%s\n", i+1, m.Name, m.ProviderLabel, current)
		}
	case command == "/model":
		n, _ := strconv.Atoi(arg)
		if n < 1 || n > len(models) {
			fmt.Println("Run /model, then /model <n>")
			return nil
		}
		model = models[n-1].Name
		fmt.Printf("Using %s\n", model)
	default:
		fmt.Println("Commands: /user <name>, /new, /list, /open <n>, /model [n]")
	}
	return nil
}

// send posts only the new message. Twigg adds it to the chat, builds the context and streams the reply.
func send(text string) error {
	if chat == "" {
		var created struct{ ID string }
		title := []rune(text)[:min(50, len([]rune(text)))]
		if _, err := twigg("/chats", map[string]string{"namespace": "twigg-demo/" + user, "title": string(title)}, &created); err != nil {
			return err
		}
		chat = created.ID
	}
	res, err := twigg("/chats/"+chat+"/responses", map[string]any{"model": model, "input": []map[string]string{{"type": "prompt", "text": text}}}, nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	lines, event := bufio.NewScanner(res.Body), ""
	lines.Buffer(nil, 1<<20)
	for lines.Scan() {
		line := lines.Text()
		if name, ok := strings.CutPrefix(line, "event:"); ok {
			event = strings.TrimSpace(name)
		}
		data, ok := strings.CutPrefix(line, "data:")
		if !ok {
			continue
		}
		var part struct{ Kind, Text, Message string }
		if err := json.Unmarshal([]byte(data), &part); err != nil {
			return err
		}
		if event == "delta" && part.Kind == "text" {
			fmt.Print(part.Text)
		}
		if event == "error" {
			return errors.New(part.Message)
		}
	}
	fmt.Print("\n\n")
	return lines.Err()
}

// twigg calls the API. Given into, it decodes the JSON reply; otherwise the caller reads the stream.
func twigg(path string, body, into any) (*http.Response, error) {
	method, payload := "GET", []byte{}
	if body != nil {
		method = "POST"
		payload, _ = json.Marshal(body)
	}
	req, err := http.NewRequest(method, api+path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		detail, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return nil, fmt.Errorf("Twigg %d: %s", res.StatusCode, detail)
	}
	if into != nil {
		defer res.Body.Close()
		return res, json.NewDecoder(res.Body).Decode(into)
	}
	return res, nil
}

func prompt(label string) (string, bool) {
	fmt.Print(label)
	ok := stdin.Scan()
	return strings.TrimSpace(stdin.Text()), ok
}

// loadEnv reads ./.env, if there is one; variables already set win.
func loadEnv(path string) {
	data, _ := os.ReadFile(path)
	for _, line := range strings.Split(string(data), "\n") {
		name, value, found := strings.Cut(strings.TrimSpace(line), "=")
		name = strings.TrimSpace(name)
		if _, set := os.LookupEnv(name); found && !set && !strings.HasPrefix(name, "#") {
			os.Setenv(name, strings.Trim(strings.TrimSpace(value), `"'`))
		}
	}
}
