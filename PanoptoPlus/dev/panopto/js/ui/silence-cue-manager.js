/**
 * @file Silence Cue Manager uses the texttrack system to keep track of when to jump in the event of silence, and subsequently handles the jump.
 */
let SilenceCueManager = (() => {
    /**
     * Silence Cue Manager uses the texttrack system to keep track of when to jump in the event of silence, and subsequently handles the jump.
     */
    class SilenceCueManager {
        /**
         * Constructor is empty
         */
        constructor() {}

        /**
         * Initialize Silence Cue Manager.
         * @returns {undefined}
         */
        init() {
            VideosLoadedEvent.subscribe(() => { 
                this.loadSilenceCues(); 
            });
        }

        /**
         * Load videos with cues tracks and skip as necessary.
         * @returns {undefined}
         */
        async loadSilenceCues() {
            let elements = VideosLoadedEvent.getVideosElements();

            SilenceCueManager.cueTrack = elements.primaryVideo.addTextTrack("metadata", "silenceCues");

            //Todo: add cached cues here

            //Inject function into user page to access Panopto object
            var injectedFunc = () => {
                //There's no way to create a texttrack with id and insert it into the video. Thus, we'll have to do this the old fashioned way
                //let cueTrack = document.getElementsByTagName("video")[0].textTracks.getTrackById("SilenceCueTrack");
                let textTrackList =  document.getElementsByTagName("video")[0].textTracks;
                let cueTrack = null;
                for (let i = 0; i < textTrackList.length; i++) {
                    if (textTrackList[i].label === "silenceCues") {
                        cueTrack = textTrackList[i];
                        break;
                    }
                }
                //Units are in seconds
                const videoDOMs = document.getElementsByTagName("video");
                const hasMultipleVideos = videoDOMs.length > 1;
                const FAST_JUMP_THRESHOLD = 0.04;
                const DESYNC_LIMIT = 10;
                let lastSynced = 0;
                let totalTimeSaved = 0;
                let startTime = Date.now();
                let elapsedTime = 0;
                //Todo: add setting configs to influence playback rate
                cueTrack.oncuechange = function () {
                    let cues = cueTrack.activeCues;
                    //Add an additional prevTime variable to prevent getting stuck
                    let prevTime = 0;
                    //If on enter
                    if (cues.length > 0) {
                        //Calculate offset and skip if necessary
                        //Prefer fast jump by currentTime. However, can cause desyncing if multiple streams involved.
                        let offset = cues[0].endTime - cues[0].startTime;
                        totalTimeSaved += offset;
                        lastSynced += offset;
                        if (!hasMultipleVideos || lastSynced < DESYNC_LIMIT || offset < FAST_JUMP_THRESHOLD) {
                            for (let i = 0; i < videoDOMs.length; i++)
                                videoDOMs[i].currentTime += offset;
                        } else if (lastSynced > DESYNC_LIMIT && prevTime < cues[0].endTime) {
                            //Call Panopto's API to reposition and avoid desync issue
                            //Panopto's implementation can be a bit laggy though, so only call if it runs the risk of desync
                            //However this lag is warranted because it helps to prevent weird issues
                            prevTime = cues[0].endTime;
                            Panopto.Viewer.Viewer.position(cues[0].endTime);
                            lastSynced = 0;
                            //console.info("Synced using Panopto API");
                        }
                        elapsedTime = (Date.now() - startTime) / 1000;
                        //console.info(`Jump made from ${cues[0].startTime} to ${cues[0].endTime}, reduced by: ${cues[0].endTime - cues[0].startTime}`, `sync time: ${lastSynced}`);
                        console.info(`Time saved: ${totalTimeSaved.toFixed(4)}`, `elapsed: ${elapsedTime}`, `multipler rate: ${(1 + totalTimeSaved / elapsedTime).toFixed(2)}x`);
                        
                    }
                };
            }
            let ctxBridge = new ContextBridge(injectedFunc);
            ctxBridge.exec();

            //Set to show tracks after a brief delay (Doesn't work without delay, this is a hotfix)
            let showing = true;
            do {
                showing = true;
                await sleep(500);
                //Show track(s)
                SilenceCueManager.cueTrack.mode = "hidden";
                await sleep(200);
                //Verify tracks are indeed not hidden
                showing &= SilenceCueManager.cueTrack.mode === "hidden";
            } while(!showing);

            console.log("Silence Cues loaded");
        };

        /**
         * Convert id to index (e.g. "00012.ts" to 12)
         * @param {String} id relurl of the TS file
         * @returns {Number} returns the number (i.e. index) of the TS file
         */
        static idToIndex(id) {
            return parseInt(id.substr(0, id.length - 3));
        }
        
        /**
         * Add silence cues based on start time & result object
         * linkages:
         * speaking -> speaking OR !speaking -> !speaking: No modification
         * speaking -> !speaking: No modification
         * !speaking -> speaking: Addition of cue, !speaking = start time, speaking = end time
         * @param {String} id relurl of the TS file
         * @param {Array.<{isSpeaking: Boolean, time: Number}>} results results from prociessing a TS file
         * @returns {undefined}
         */
        static addSilenceCues(id, results) {
            let index = SilenceCueManager.idToIndex(id);
            //Assume is not speaking at the start 
            for (let i = 0; i < results.length; i++) {
                let tmp = null;
                if (results[i].isSpeaking) {
                    //If is speaking and first and the previous was not speaking
                    if (i === 0 
                        && (tmp = SilenceCueManager.cuesMap[index - 1]) != null
                        && tmp.length > 0
                        && !tmp[tmp.length - 1].isSpeaking) {
                        //Link with previous
                        SilenceCueManager.addSilentCue(tmp[tmp.length - 1].time, results[i].time);
                    }
                    //Else do nothing
                } else {
                    //If is not speaking and last and next is speaking
                    if (i === results.length - 1 
                        && (tmp = SilenceCueManager.cuesMap[index + 1]) != null
                        && tmp.length > 0
                        && tmp[0].isSpeaking) {
                        //Link with next
                        SilenceCueManager.addSilentCue(results[i].time, tmp[tmp.length - 1].time);
                    }
                    //Else check if can link with next
                    if (results[i + 1] != null && results[i + 1].isSpeaking) {
                        SilenceCueManager.addSilentCue(results[i].time, results[i + 1].time);
                    }
                }
            }
        }

        /**
         * Add silent cue for video to take action
         * @param {Number} startTime start of silence
         * @param {Number} endTime end of silence
         * @returns {undefined}
         */
        static addSilentCue(startTime, endTime) {
            SilenceCueManager.cueTrack.addCue(new VTTCue(startTime, endTime, ""));
        }

        /**
         * Add results from TSTracker to cache
         * @param {String} id relurl of the TS file
         * @param {Array} results [{isSpeaking: Boolean, time: Number}, ...]
         * @returns {undefined}
         */
        static addToCache(id, results) {
            //Save to map
            SilenceCueManager.cuesMap[SilenceCueManager.idToIndex(id)] = results;
            //Do other caching stuff
        }
    }

    //Static variables
    SilenceCueManager.cueTrack = null;
    SilenceCueManager.cuesMap = {};

    return SilenceCueManager;
})();