; Return a list of the results of calling transformer f on each item in the list.
(define (stamper-helper-map f lst)
  (if (pair? lst)
    (cons (f (car lst)) (stamper-helper-map f (cdr lst)))
    '()
    )
  )

; Return list '(TRUE, <X>) where X is the first item in the list where predicate f returns TRUE, or return '(FALSE) if no item returned TRUE
(define (stamper-helper-try-first f lst)
  (if (pair? lst)
    (if (= (f (car lst)) TRUE)
      (list TRUE (car lst))
      (stamper-helper-try-first f (cdr lst))
      )
    (list FALSE)
    )
  )

; Open the stamping background and foreground images, and return a consistent "stamper-env" object containing them used by other functions.
(define (stamper-setup-env background-filename foreground-filenames)
  (let* (; source-layers-image just serves to hold the foreground-layers, but we start by opening background for consistent image properties
         (source-layers-image (car (gimp-file-load RUN-NONINTERACTIVE background-filename background-filename)))
         (source-layers-image-background-layer (car (gimp-image-get-active-layer source-layers-image)))
         ; this image will be the starting point, copied for each stamp, so that we don't need to copy _all_ the foreground-layers when we stamp
         (background-image (car (gimp-image-duplicate source-layers-image)))
         (background-layer (car (gimp-image-get-active-layer background-image)))
         (foreground-layers
           (stamper-helper-map
             (lambda (foreground-filename) 
               (let* ((foreground-layer (car (gimp-file-load-layer RUN-NONINTERACTIVE source-layers-image foreground-filename)))
                      )
                 (print "Loaded:")
                 (print foreground-filename)
                 (gimp-image-insert-layer source-layers-image foreground-layer 0 0)
                 (gimp-item-set-visible foreground-layer FALSE)
                 (list foreground-filename foreground-layer)
                 )
               )
             foreground-filenames
             )
           )
         )

    ; this is assumed to be smaller than our source images.
    ; 100x100 is plenty for our purposes, and smaller images = faster processing (which is important during stamping)
    (gimp-image-scale source-layers-image 100 100)
    ; extra 20px buffer on all sides; wax-seal script requires a buffer
    ; (note, this scales the content, but we'll replace it with the 100x100 content in a second)
    (gimp-image-scale background-image 140 140)

    (let* ((proper-background-layer (car (gimp-layer-new-from-drawable source-layers-image-background-layer background-image)))
           (orig-context-feather (car (gimp-context-get-feather)))
           (orig-context-sample-criterion (car (gimp-context-get-sample-criterion)))
           (orig-context-sample-threshold (car (gimp-context-get-sample-threshold)))
           )

      ; replace content with 100x100 layer, centered in 20px buffer
      (gimp-image-insert-layer background-image proper-background-layer 0 0)
      (gimp-image-remove-layer background-image background-layer)
      (gimp-layer-set-offsets proper-background-layer 20 20)

      ; ---V  cut out translucent edge pixels that appeared during rescaling  V---
      (gimp-context-set-feather FALSE)
      (gimp-context-set-sample-criterion SELECT-CRITERION-A)
      (gimp-context-set-sample-threshold 0.0)

      ; not sure how to specify alpha here, but it seems to default to 1 which is luckily what we want anyways!
      (gimp-image-select-color background-image CHANNEL-OP-REPLACE proper-background-layer (list 0 0 0))
      (gimp-selection-invert background-image)
      (gimp-drawable-edit-clear proper-background-layer)
      (gimp-selection-none background-image)

      (gimp-context-set-feather orig-context-feather)
      (gimp-context-set-sample-criterion orig-context-sample-criterion)
      (gimp-context-set-sample-threshold orig-context-sample-threshold)
      ; ---^  cut out translucent edge pixels that appeared during rescaling  ^---

      (list background-image proper-background-layer source-layers-image foreground-layers)
      )
    )
  )

; Clean up all resources in the stamper-env -- obviously unusable after calling this.
(define (stamper-teardown-env stamper-env)
  (let* ((background-image (car stamper-env))
         (background-layer (car (cdr stamper-env)))
         (source-layers-image (car (cdr (cdr stamper-env))))
         (foreground-layers (car (cdr (cdr (cdr stamper-env)))))
         )
    (gimp-image-clean-all background-image)
    (gimp-image-delete background-image)
    (gimp-image-clean-all source-layers-image)
    (gimp-image-delete source-layers-image)
    )
  )

; Create a stamp image. Pass the foreground image (icon) filename to use, 
; and a list of lists containing the (x,y) coordinates of the offsets of each icon impression (offset from centered).
(define (stamper-stamp stamper-env foreground-filename offsets destination-filename)
  (begin
    (gimp-debug-timer-start)
    (let* ((background-image (car stamper-env))
          (background-layer (car (cdr stamper-env)))
          (source-layers-image (car (cdr (cdr stamper-env))))
          (foreground-layers (car (cdr (cdr (cdr stamper-env)))))
          
          (foreground-layer 
            (let* ((try-first-result
                      (stamper-helper-try-first 
                        (lambda (foreground-layer-pair)
                          (let* ((filename (car foreground-layer-pair))
                                (layer (car (cdr foreground-layer-pair)))
                                )
                            (if (equal? filename foreground-filename) TRUE FALSE)
                            )
                          )
                        foreground-layers
                        )
                      )
                    (try-first-success (car try-first-result))
                    )
              (if (equal? try-first-success TRUE)
                (car (cdr (car (cdr try-first-result))))
                (car (cdr (car foreground-layers))) ; if filename wasn't found, just use the first foreground layer
                )
              )
            )
          
          (working-image
            (begin
              (gimp-item-set-visible foreground-layer TRUE)
              (let* ((working-image (car (gimp-image-duplicate background-image)))
                    (working-background-layer (car (gimp-image-get-active-layer working-image)))
                    (working-foreground-layers
                      (stamper-helper-map
                        (lambda (offset)
                          (let* ((offset-x (car offset))
                                (offset-y (car (cdr offset)))
                                (working-foreground-layer (car (gimp-layer-new-from-drawable foreground-layer working-image)))
                                (orig-context-feather (car (gimp-context-get-feather)))
                                (orig-context-sample-threshold (car (gimp-context-get-sample-threshold)))
                                )
                            (gimp-image-insert-layer working-image working-foreground-layer 0 0)
                            (gimp-layer-set-offsets working-foreground-layer
                              (+ offset-x (- (/ (car (gimp-image-width working-image)) 2) (/ (car (gimp-drawable-width working-foreground-layer)) 2)))
                              (+ offset-y (- (/ (car (gimp-image-height working-image)) 2) (/ (car (gimp-drawable-height working-foreground-layer)) 2)))
                              )

                            ; ---V cut foreground layers at the edge of the background layer, and apply a 4px special border V---
                            ; (this border only applies at the edge of the background layer, and constrained by the foreground layer;
                            ;  the border is made up of 2px white inside of 2px black, and ensures the foreground layer both:
                            ;    1. does not appear to have its white contents "leak" into the outside, and
                            ;    2. does not have its ridges interpreted as part of the seal edge, which is less sharp than "internal symbol" ridge
                            ;  )

                            ; apply the 2px white border first by filling the "seal-outside" portion of the foreground (grown by 4px) with white
                            ; (4px comes from the 2px white we want + the 2px black we will apply later)
                            (gimp-image-set-active-layer working-image working-background-layer)
                            (gimp-image-select-contiguous-color
                              working-image
                              CHANNEL-OP-REPLACE
                              working-background-layer
                              (/ (car (gimp-image-width working-image)) 2)
                              (/ (car (gimp-image-height working-image)) 2)
                              )
                            (gimp-selection-shrink working-image 4)
                            (gimp-selection-invert working-image)

                            ; un-intersect transparent areas of the foreground, which can result in weird looks in some positions
                            (gimp-context-set-feather FALSE)
                            ; filling the translucent edges is desireable, this catches those even with composite select for some reason:
                            (gimp-context-set-sample-threshold 1.0)
                            ; not sure how to specify alpha here, but it seems to default to 1 which is luckily what we want anyways!
                            (gimp-image-select-color working-image CHANNEL-OP-INTERSECT working-foreground-layer (list 0 0 0))

                            (gimp-image-set-active-layer working-image working-foreground-layer)
                            (gimp-edit-bucket-fill
                              working-foreground-layer
                              BUCKET-FILL-BG
                              LAYER-MODE-NORMAL-LEGACY
                              100 20 FALSE 0 0)

                            (gimp-context-set-feather orig-context-feather)
                            (gimp-context-set-sample-threshold orig-context-sample-threshold)

                            ; apply the 2px black border second, by deleting all the white fill in the "seal-outside" portion of the foreground,
                            ; (grown by 2px in order to reveal 2px of the edge of the background layer below)
                            (gimp-item-set-visible working-foreground-layer FALSE)
                            (gimp-image-set-active-layer working-image working-background-layer)
                            (gimp-image-select-contiguous-color
                              working-image
                              CHANNEL-OP-REPLACE
                              working-background-layer
                              (/ (car (gimp-image-width working-image)) 2)
                              (/ (car (gimp-image-height working-image)) 2)
                              )
                            (gimp-selection-shrink working-image 2)
                            (gimp-selection-invert working-image)
                            (gimp-item-set-visible working-foreground-layer TRUE)

                            (gimp-image-set-active-layer working-image working-foreground-layer)
                            (gimp-drawable-edit-clear working-foreground-layer)
                            ; ---^ cut foreground layers at the edge of the background layer, and apply a 4px special border ^---

                            (gimp-item-set-visible working-foreground-layer FALSE)

                            working-foreground-layer
                            )
                          )
                        offsets
                        )
                      )
                    )

                (gimp-item-set-visible foreground-layer FALSE)

                (stamper-helper-map
                  (lambda (working-foreground-layer) (gimp-item-set-visible working-foreground-layer TRUE))
                  working-foreground-layers
                  )

                working-image
                )
              )
            )
          (working-layer (car (gimp-image-flatten working-image)))

          ;(working-image
          ;  (begin
          ;    (gimp-item-set-visible foreground-layer TRUE)
          ;    (let* ((working-image (car (gimp-image-duplicate source-layers-image)))
          ;            )
          ;      (gimp-item-set-visible foreground-layer FALSE)
          ;      working-image
          ;      )
          ;    )
          ;  )
          ;(working-layer (car (gimp-image-flatten working-image)))

          (wax-color (list 67 5 5))
          (light-azimuth 315)
          (light-elevation 45)
          (light-depth 20)
          (border-thickness 20)
          (border-threshold 20)
          (inner-hollow? FALSE)
          (symbol-separate? TRUE)
          (symbol-thickness 5)
          (bump-border? TRUE)
          (bump-granularity 3.0)
          (bump-smoothness 13)
          (bump-seed 0)
          (highlight-size 15)
          (highlight-start 235)
          (highlight-smoothness 5)
          (is-text? FALSE)
          )

      (gimp-image-clean-all working-image)
      (gimp-file-save RUN-NONINTERACTIVE working-image working-layer "template.png" "template.png")

      (gimp-debug-timer-end)
      (print "Setup Complete")

      (gimp-debug-timer-start)
      (script-fu-wax-sealimg working-image working-layer
                            wax-color
                            light-azimuth light-elevation light-depth
                            border-thickness border-threshold
                            inner-hollow?
                            symbol-separate? symbol-thickness
                            bump-border? bump-granularity bump-smoothness bump-seed
                            highlight-size highlight-start highlight-smoothness
                            is-text?)
      (gimp-debug-timer-end)
      (print "Seal Created")

      (gimp-debug-timer-start)
      (gimp-image-clean-all working-image)
      (let* ((wax-layer (car (gimp-image-get-active-layer working-image)))
             )
        (gimp-file-save RUN-NONINTERACTIVE working-image wax-layer destination-filename destination-filename)
        (gimp-debug-timer-end)
        (print "Seal Saved")
        (gimp-image-delete working-image)
        )
      )
    )
  )
