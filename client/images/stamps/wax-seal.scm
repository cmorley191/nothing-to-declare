;; wax-seal.scm -*-scheme-*-
;; Wax Seal - create wax-seal-looking object from original picture
;;
;; This is a version compatible with GIMP v1.1.20
;;
;; Copyright (C) 2000 by Jaroslav Benkovsky <Edheldil@atlas.cz>
;; Released under General Public License (GPL)
;;
;; $Id: wax-seal.scm,v 1.3 2000/06/26 01:02:31 benkovsk Exp $
;;
;; Requires:
;;    plug-in-plasma
;;    plug-in-emboss
;;    plug-in-gauss-rle
;;
;; source image is rgb or grayscale, with black-on-white picture



;�ǉ�
(define (script-fu-wax-seal img drawable wax-color 
			    light-azimuth light-elevation light-depth 
			    border-thickness border-threshold 
			    inner-hollow? symbol-separate? symbol-thickness 
			    bump? bump-granularity bump-smoothness bump-seed
			    highlight-size highlight-start highlight-smoothness)

    (let* ((hznimg 0)					;�ǉ�
	   (hzndra 0)					;�ǉ�
    )

    (set! hznimg (car (gimp-channel-ops-duplicate img)) img)
    (set! hzndra (car (gimp-image-flatten hznimg)))

    (script-fu-wax-sealimg hznimg hzndra wax-color 
			light-azimuth light-elevation light-depth
			border-thickness border-threshold
			inner-hollow? symbol-separate? symbol-thickness
			bump? bump-granularity bump-smoothness bump-seed
			highlight-size highlight-start highlight-smoothness FALSE)

   (gimp-image-clean-all hznimg)
   (gimp-display-new hznimg)
)							;�ǉ�
)



(define (script-fu-wax-sealimg img drawable wax-color 
			    light-azimuth light-elevation light-depth 
			    border-thickness border-threshold 
			    inner-hollow? symbol-separate? symbol-thickness 
			    bump? bump-granularity bump-smoothness bump-seed
			    highlight-size highlight-start highlight-smoothness text?)

  (let* ((width (car (gimp-drawable-width drawable)))
	 (height (car (gimp-drawable-height drawable)))
	 (aliassel TRUE)
	 (old-fg (car (gimp-palette-get-foreground)))
	 (old-bg (car (gimp-palette-get-background)))
	 (type (car (gimp-drawable-type drawable)))
	 (alpha-type (cond ((= type RGB-IMAGE) RGBA-IMAGE)
			   ((= type RGBA-IMAGE) RGBA-IMAGE)
			   ((= type GRAY-IMAGE) GRAYA-IMAGE)
			   ((= type GRAYA-IMAGE) GRAYA-IMAGE)))
	 (color-layer (car (gimp-layer-new img width height alpha-type "color layer" 100  LAYER-MODE-NORMAL-LEGACY)))
	 (mask-layer (car (gimp-layer-new img width height alpha-type "mask layer" 100  LAYER-MODE-NORMAL-LEGACY)))
         (symbol-layer (car (gimp-layer-copy drawable TRUE)))
;;2.4�ǉ�
	 (maska)
	 (highlight-layer)
)


    ; setup
    (gimp-image-undo-group-start img)
    (gimp-selection-none img)
    (gimp-palette-set-foreground '(0 0 0))
    (gimp-palette-set-background '(255 255 255))

    ; get rid of transparent parts
;    (if (= (gimp-drawable-has-alpha drawable) TRUE)
;	(begin
;	  (gimp-selection-layer-alpha drawable)
;	  (gimp-selection-invert img)
;	  (gimp-edit-bucket-fill drawable BUCKET-FILL-BG LAYER-MODE-NORMAL-LEGACY 100 0 FALSE 0 0)))

 ;;   (gimp-edit-clear color-layer)           ;;�ړ������@
    (gimp-drawable-fill mask-layer FILL-WHITE)


    ; separating inner symbol
    (if (= symbol-separate? TRUE)
	(begin
(gimp-image-add-layer img symbol-layer -1)    ;;;�����Ɉړ��A
(gimp-drawable-set-visible symbol-layer FALSE)	;2.2.�ǉ�
	    (gimp-fuzzy-select symbol-layer 1 1 (* 3 border-threshold) CHANNEL-OP-ADD TRUE FALSE 0 FALSE)
	    (gimp-selection-grow img 1)
	    (gimp-edit-bucket-fill symbol-layer BUCKET-FILL-FG LAYER-MODE-NORMAL-LEGACY 100 0 FALSE 0 0)
	    (gimp-selection-none img)
	    (gimp-fuzzy-select symbol-layer 1 1 (* 3 border-threshold) CHANNEL-OP-ADD TRUE FALSE 0 FALSE)
	    (gimp-selection-grow img 1)
	    (gimp-by-color-select symbol-layer '(255 255 255) (* 0.3 border-threshold) CHANNEL-OP-ADD FALSE FALSE 0 FALSE)
	    (gimp-edit-clear symbol-layer)
	    (gimp-selection-invert img)
	    (gimp-edit-bucket-fill drawable BUCKET-FILL-BG LAYER-MODE-NORMAL-LEGACY 100 0 FALSE 0 0)
	    (gimp-selection-none img)
	    (if (> symbol-thickness 0)
		(plug-in-gauss-rle 1 img symbol-layer symbol-thickness TRUE TRUE))
	    ))


    ; prepare seal border for emboss
    (if (> border-thickness 0)
	(plug-in-gauss-rle 1 img drawable border-thickness TRUE TRUE))

    ; bumping seal top surface
    (if (= bump? TRUE)
	(begin
	    (gimp-image-add-layer img mask-layer -1)
	    (set! maska (car (gimp-layer-create-mask mask-layer ADD-MASK-WHITE)))
	    (gimp-layer-add-mask mask-layer maska)
	    (plug-in-plasma 1 img maska bump-seed bump-granularity)
	    (if (> bump-smoothness 0)
		(plug-in-gauss-rle 1 img maska bump-smoothness TRUE TRUE))
	    (gimp-layer-set-opacity mask-layer 50)
;;	    (set! drawable (car (gimp-image-flatten img)))			;2.2none
	    (set! drawable (car (gimp-image-merge-visible-layers img 0)))	;2.2add
	    (gimp-drawable-set-visible symbol-layer TRUE)			;2.2add
	    (if (= text? TRUE) (gimp-brightness-contrast drawable 80 7)		;2.4���邳30��80�Acontrast60��7�ɕύX
		(gimp-brightness-contrast drawable -30 20))			;2.0�ǉ� 2.4�ύX-30, 20
	    ))

    ; reincluding inner symbol
    (if (= symbol-separate? TRUE) 
	(begin
;	    (gimp-image-add-layer img symbol-layer -1)  ;;;�ړ������A
	    (set! drawable (car (gimp-image-flatten img)))
	    ))

   (gimp-image-add-layer img color-layer 1)   ;;�����Ɉړ�
   (gimp-edit-clear color-layer)	      ;;�����Ɉړ��@

    ; embossing the seal - monochrome
    (if (= inner-hollow? FALSE)
	(begin 
	;border-threshold�ύX
	  (gimp-fuzzy-select drawable 1 1 (+ (/ border-threshold 3) 9) CHANNEL-OP-ADD TRUE FALSE 0 FALSE))
	(begin
	;border-threshold�ύX
	  (gimp-by-color-select drawable '(255 255 255) (+ (/ border-threshold 3) 9) CHANNEL-OP-ADD TRUE FALSE 0 FALSE)))

    (gimp-selection-invert img)
    ;;2.4light-depth��ύX
    (plug-in-emboss 1 img drawable light-azimuth light-elevation (+ (/ light-depth 2) 1) TRUE)

    ; create layer with wax color - colorize the seal
    (gimp-layer-add-alpha drawable)
    (gimp-layer-set-mode drawable LAYER-MODE-HSV-VALUE-LEGACY)
    (gimp-drawable-set-name drawable "seal layer")
 ;;   (gimp-image-add-layer img color-layer 1)   ;;�ړ�����
    (gimp-palette-set-foreground wax-color)
    (gimp-edit-bucket-fill color-layer BUCKET-FILL-FG LAYER-MODE-NORMAL-LEGACY 100 0 FALSE 0 0)
    (set! drawable (car (gimp-image-merge-visible-layers img EXPAND-AS-NECESSARY)))

    ; try to create highlights
    (if (> highlight-size 0)
	(begin
	  (if (> (+ highlight-start highlight-size) 255)
	      (set! highlight-start (- 255 highlight-size)))

	  (set! highlight-layer (car (gimp-layer-copy drawable 0)))
	  (gimp-image-add-layer img highlight-layer -1)
	  (gimp-threshold highlight-layer highlight-start 
			  (+ highlight-start highlight-size))
	  (if (> highlight-smoothness 0)
	      (plug-in-gauss-rle 1 img highlight-layer highlight-smoothness TRUE TRUE))
	  (gimp-layer-set-mode highlight-layer LAYER-MODE-LIGHTEN-ONLY-LEGACY)
	  (gimp-image-merge-visible-layers img EXPAND-AS-NECESSARY)))


    ; cleanup
    (gimp-selection-none img)
    (gimp-palette-set-foreground old-fg)
    (gimp-palette-set-background old-bg)
    (gimp-image-undo-group-end img)
    (gimp-displays-flush)
))

(define (script-fu-wax-text-logo text size font wax-color bg-color create-highlight? create-shadow?)
    (let* (
	   ; script parameters' defs
	   (light-azimuth 315)
	   (light-elevation 45)
	   (light-depth (+ (/ size 30) 15))		;change
	   (bump-granularity 4)
	   (bump-smoothness 10)
	   (bump-seed 0)
	   (border (/ size 4))
	   (wax-thickness (/ size 10))
	   (shadow-depth (/ size 15))
	   (highlight-size (+ (/ size 25) 7))		;change
	   (highlight-start 235)
	   (highlight-smoothness (/ size 30))		;none
	   (highlight-smoothness 5)			;add
	   (old-fg (car (gimp-palette-get-foreground)))
	   (old-bg (car (gimp-palette-get-background)))
      	   (dummy (gimp-palette-set-foreground '(0 0 0)))
      	   (dummy2 (gimp-palette-set-background '(255 255 255)))
	   (img (car (gimp-image-new 256 256 RGB)))
	   (text-layer (car (gimp-text-fontname img -1 0 0 text border TRUE size PIXELS font)))
	   (width (car (gimp-drawable-width text-layer)))
	   (height (car (gimp-drawable-height text-layer)))

;;2.4�ǉ�
	   (layers)
	   (layer-cnt)
	   (bg-layer)
	   (s-layer)
	   )

    ; setup
    (gimp-image-undo-disable img)
    (if (> size 150) (set! highlight-smoothness (/ size 30)))	;add
    (if (< size 120) (set! highlight-size (+ (/ size 20) 8)))	;add
    (if (< size 90) (set! highlight-size (+ (/ size 12) 12)))	;add
    (if (< size 70) (set! highlight-size (+ (/ size 8) 14)))	;add
    (if (< size 60) (set! highlight-size (+ (/ size 4) 16)))	;add
    (if (< size 100) (set! shadow-depth (/ size 20)))		;add
    (if (< size 80) (set! shadow-depth (/ size 30)))		;add
    (if (< size 70) (set! highlight-start 220))			;add
    (gimp-image-resize img width height 0 0)
    (if (< light-depth 20) (set! light-depth 20))		;add
    (if (< highlight-size 15) (set! highlight-size 15))		;add
    (if (< highlight-smoothness 5) (set! highlight-size 5))	;add


    (if (= create-highlight? FALSE)
	(set! highlight-size 0))

    ; "waxify" the text
    (set! text-layer (car (gimp-image-flatten img)))
    (script-fu-wax-sealimg img text-layer wax-color 
			light-azimuth light-elevation light-depth
			wax-thickness 20 TRUE FALSE 0 TRUE 
			bump-granularity bump-smoothness bump-seed
			highlight-size highlight-start highlight-smoothness TRUE)

    (set! layers (gimp-image-get-layers img))
    (set! layer-cnt (car layers))
    (set! text-layer (aref (cadr layers) 0))

    ; add background layer and color
    (set! bg-layer (car (gimp-layer-new img width height RGB-IMAGE "Background" 100 LAYER-MODE-NORMAL-LEGACY)))
    (gimp-palette-set-background bg-color)
    (gimp-image-add-layer img bg-layer layer-cnt)
    (gimp-edit-fill bg-layer FILL-BACKGROUND)     ;;��̂Ɠ���ւ���

    ; add shadow layer
    (if (= create-shadow? TRUE)
	(begin
	  (set! s-layer (car (gimp-layer-new img width height RGBA-IMAGE "Shadow Layer" 75 LAYER-MODE-NORMAL-LEGACY)))
	  (gimp-image-add-layer img s-layer layer-cnt)
	  (gimp-edit-clear s-layer)
	  (gimp-selection-layer-alpha text-layer)
	  (gimp-edit-bucket-fill s-layer BUCKET-FILL-FG LAYER-MODE-NORMAL-LEGACY 100 100 FALSE 0 0)
	  (gimp-selection-none img)
	  (plug-in-mblur 1 img s-layer 0 shadow-depth (- light-azimuth 90) 0 0)
	  (plug-in-gauss-rle 1 img s-layer shadow-depth TRUE TRUE)
	  ))

    ; cleanup
    (gimp-palette-set-foreground old-fg)
    (gimp-palette-set-background old-bg)
    (gimp-image-undo-enable img)
    (gimp-display-new img)
))


(script-fu-register "script-fu-wax-seal"
		    "<Image>/Filters/Decor/Wax Seal"
		    "Create wax-seal (or plasticine) looking object from original image. The image should be black on white, not blurred, and should not be too close to image bounds."
		    "Jaroslav Benkovsky <Edheldil@atlas.cz>"
		    "Jaroslav Benkovsky"
		    "June 2000"
		    "RGB*, GRAY*"

		    SF-IMAGE "Image"                 0
		    SF-DRAWABLE "Drawable"           0

		    SF-COLOR "Wax Color"             '(170 13 13)

		    SF-ADJUSTMENT "Light Azimuth"    '(315 0 359 1 10 0 0)
		    SF-ADJUSTMENT "Light Elevation"  '(45 0 90 1 10 0 0)
		    SF-ADJUSTMENT "Light Depth"      '(20 1 100 1 10 0 0)

		    SF-ADJUSTMENT "Border Thickness" '(20 0 1000 1 10 0 1)
		    SF-ADJUSTMENT "Border Threshold" '(20 0 50 1 10 0 1)

		    SF-TOGGLE "Make Inner Hollow"    FALSE
		    SF-TOGGLE "Symbol Separate"      TRUE
		    SF-ADJUSTMENT "Symbol Thickness" '(5 0 1000 1 10 0 1)

		    SF-TOGGLE "Bump Border"          TRUE
		    SF-ADJUSTMENT "Bump Granularity" '(3 0.1 7.0 0.1 1 1 0)
		    SF-ADJUSTMENT "Bump Smoothness"  '(13 0 500 1 10 0 1)
		    SF-ADJUSTMENT "Bump Seed"	     '(0 0 100000 1 10 0 1)

		    SF-ADJUSTMENT "Highlight Size"   '(15 0 255 1 10 0 1)
		    SF-ADJUSTMENT "Highlight Start"  '(235 0 255 1 10 0 1)
		    SF-ADJUSTMENT "Hlit. Smoothness" '(5 0 500 1 10 0 1)
)

(script-fu-register "script-fu-wax-text-logo"
		    "<Image>/Logos/Wax Text"
		    "Create text logo made from seal wax (or plasticine)."
		    "Jaroslav Benkovsky <Edheldil@atlas.cz>"
		    "Jaroslav Benkovsky"
		    "June 2000"
		    ""

		    SF-STRING "Text String"       "Wax Text"
		    SF-ADJUSTMENT "Size (pixels)" '(150 2 1000 1 10 0 1)
		    SF-FONT "Font" "Arial Black"
		    SF-COLOR "Wax Color"          '(170 13 13)
		    SF-COLOR "BG Color"           '(255 255 255)
		    SF-TOGGLE "Create Highlight"  TRUE
		    SF-TOGGLE "Create Shadow"     TRUE
)


;; End of file wax-seal.scm
