.PHONY: social-preview fameboy-og

SOCIAL_HTML ?= assets/social-preview.html
SOCIAL_PNG ?= assets/social-preview.png
SOCIAL_VIEWPORT ?= 1200,630

# The repo's social preview. Upload the PNG at Settings -> General -> Social preview.
# The microsite has its own: site/img/share/home.jpg (pnpm share:render).
social-preview:
	bash scripts/capture_social_preview.sh "$(SOCIAL_HTML)" "$(SOCIAL_PNG)" "$(SOCIAL_VIEWPORT)"

# fameboy's link preview: every page a fameboy serves (demo.createfc.org included) points at its /og.png.
fameboy-og:
	bash scripts/capture_social_preview.sh assets/fameboy-og.html client/ui/og.png "$(SOCIAL_VIEWPORT)"
