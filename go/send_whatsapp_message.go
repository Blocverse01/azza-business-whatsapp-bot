package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

func sendWhatsappMessage(cloudApiAccessToken, cloudApiUrl, businessPhoneNumberId, message string) (map[string]interface{}, error) {
	messagesRequestUrl := fmt.Sprintf("%s/%s/messages", cloudApiUrl, businessPhoneNumberId)

	decodedMessage, err := base64.StdEncoding.DecodeString(message)
	if err != nil {
		log.Fatalf("Failed to decode message: %v", err)
	}

	// HTTP Request setup
	bodyData := bytes.NewBuffer(decodedMessage)
	req, err := http.NewRequest("POST", messagesRequestUrl, bodyData)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %w", err)
	}

	req.Header.Add("Content-Type", "application/json")
	req.Header.Add("Authorization", fmt.Sprintf("Bearer %s", cloudApiAccessToken))

	// Measure request time
	startTime := time.Now()
	client := &http.Client{}
	resp, err := client.Do(req)
	elapsed := time.Since(startTime).Milliseconds()

	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {
			return
		}
	}(resp.Body)

	// Read response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	// Prepare the response
	response := map[string]interface{}{
		"status":       resp.Status,
		"statusCode":   resp.StatusCode,
		"elapsedTime":  elapsed,
		"responseBody": string(body),
	}

	return response, nil
}

func main() {
	// Parse command-line arguments
	cloudApiAccessToken := flag.String("token", "", "Cloud API Access Token")
	cloudApiUrl := flag.String("url", "", "Cloud API Base URL")
	businessPhoneNumberId := flag.String("id", "", "Business Phone Number ID")
	message := flag.String("message", "", "Base64-encoded JSON message")

	flag.Parse()

	if *cloudApiAccessToken == "" || *cloudApiUrl == "" || *businessPhoneNumberId == "" || *message == "" {
		fmt.Println(`{"error": "Missing required arguments"}`)
		os.Exit(1)
	}

	// Call sendMessage
	response, err := sendWhatsappMessage(*cloudApiAccessToken, *cloudApiUrl, *businessPhoneNumberId, *message)
	if err != nil {
		errorResponse := map[string]interface{}{
			"error": err.Error(),
		}
		jsonOutput, _ := json.Marshal(errorResponse)
		fmt.Println(string(jsonOutput))
		os.Exit(1)
	}

	// Print response as JSON
	jsonOutput, _ := json.Marshal(response)
	fmt.Println(string(jsonOutput))
}
