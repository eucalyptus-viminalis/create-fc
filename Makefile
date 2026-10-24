.PHONY: social-preview fameboy-og

SOCIAL_HTML ?= assets/social-preview.html
SOCIAL_PNG ?= assets/social-preview.png
SOCIAL_VIEWPORT ?= 1200,630

# The repo's social preview. Upload the PNG at Settings -> General -> Social preview.
# The microsite has its own: site/img/share/home.jpg (pnpm share:render).
social-preview:
	bash scripts/capture_social_preview.sh "$(SOCIAL_HTML)" "$(SOCIAL_PNG)" "$(SOCIAL_VIEWPORT)"

# fameboy's link preview: every page a fameboy serves points at its /og.png, or at
# og-<its host>.png when there is one, like demo.createfc.org's with its QR code.
fameboy-og:
	bash scripts/capture_social_preview.sh assets/fameboy-og.html client/ui/og.png "$(SOCIAL_VIEWPORT)"
	bash scripts/capture_social_preview.sh assets/fameboy-og.html client/ui/og-demo.createfc.org.png "$(SOCIAL_VIEWPORT)" demo
