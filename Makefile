.PHONY: social-preview

SOCIAL_HTML ?= assets/social-preview.html
SOCIAL_PNG ?= assets/social-preview.png
SOCIAL_VIEWPORT ?= 1200,630

# Social preview for both the repo and the microsite. Upload the PNG at
# Settings -> General -> Social preview; site/og.png ships with the site.
social-preview:
	bash scripts/capture_social_preview.sh "$(SOCIAL_HTML)" "$(SOCIAL_PNG)" "$(SOCIAL_VIEWPORT)"
	cp "$(SOCIAL_PNG)" site/og.png  # the microsite's link preview; Pages only publishes site/
