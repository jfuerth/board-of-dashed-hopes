function showError(messageHtml) {
    var errors = document.getElementById("errors");
    errors.style.display = "block";
    errors.innerHTML = messageHtml;
}
function clearErrors() {
    var errors = document.getElementById("errors");
    errors.style.display = "none";
    errors.innerHTML = "";
}
function onAuthSuccess() {
    document.getElementById("login").style.display = "none";
    refreshPipelineView();
}
function onAuthFailure(reason) {
    showError(reason + " Please log in again.");
    document.getElementById("login").style.display = "block";

    var failedDiv = document.getElementById("pipelines_failed");
    failedDiv.innerHTML = "";

    var runningDiv = document.getElementById("pipelines_running");
    runningDiv.innerHTML = "";

    var successDiv = document.getElementById("pipelines_success");
    successDiv.innerHTML = "";
}
function refreshPipelineView() {
    console.log("Attempting to refresh pipeline view...");
    concourse.getPipelines(function(pipelines) {
        console.log("Got fresh pipeline data. Refreshing UI...");
        clearErrors();

        pipelines.sort(function(p1, p2) {
            if (p1.newestFailureTime > 0 || p2.newestFailureTime > 0) {
                if (p1.newestFailureTime === p2.newestFailureTime) {
                    return 0;
                }
                if (p1.newestFailureTime < p2.newestFailureTime) {
                    return 1;
                }
                return -1;
            }

            if (p1.newestRunningTime > 0 || p2.newestRunningTime > 0) {
                if (p1.newestRunningTime === p2.newestRunningTime) {
                    return 0;
                }
                if (p1.newestRunningTime < p2.newestRunningTime) {
                    return 1;
                }
                return -1;
            }

            if (p1.newestSuccessTime > 0 || p2.newestSuccessTime > 0) {
                if (p1.newestSuccessTime === p2.newestSuccessTime) {
                    return 0;
                }
                if (p1.newestSuccessTime < p2.newestSuccessTime) {
                    return 1;
                }
                return -1;
            }

            return 0;
        });

        var failedDiv = document.getElementById("pipelines_failed");
        failedDiv.innerHTML = "";

        var runningDiv = document.getElementById("pipelines_running");
        runningDiv.innerHTML = "";

        var successDiv = document.getElementById("pipelines_success");
        successDiv.innerHTML = "";

        var pdiv = failedDiv;
        for (var i = 0; i < pipelines.length; i++) {
            var p = pipelines[i];
            if (p.newestFailureTime === 0 && pdiv === failedDiv) {
                pdiv = runningDiv;
            }
            if (p.newestRunningTime === 0 && pdiv === runningDiv) {
                pdiv = successDiv;
            }
            pdiv.appendChild(makePipelineDiv(p));
        }
    });
}
function makePipelineDiv(p) {
    var div = document.createElement("div");
    var hasOldJob = false;

    div.id = "pipeline-" + p.name;
    div.innerHTML = "<h1>" + p.name + "</h1>";

    for (var i = 0; i < p.jobs.length; i++) {
        let j = p.jobs[i];
        let fb = j["finished_build"];
        let nb = j["next_build"];

        let styleClasses = "job";
        let statusWithTime = "Never Ran";
        if (fb != null) {
            styleClasses += " " + fb.status;
            statusWithTime = fb.status + " " + relativeTime(new Date(fb["end_time"] * 1000))
            if (fb.status === 'failed') {
                say(p.name + " " + j.name + " " + statusWithTime, p.name + ":" + j.name, 60 * 60);
            }
        }
        if (nb != null) {
            styleClasses += " " + nb.status;
            statusWithTime = nb.status + " " + relativeTime(new Date(nb["start_time"] * 1000))
        }

        if (statusWithTime.indexOf("weeks") != -1) {
            hasOldJob = true;
        }

        let jdiv = document.createElement("div");
        jdiv.id = "job-" + p.name + "-" + j.name;
        jdiv.className = styleClasses;
        jdiv.innerHTML = "<h2>" + j.name + "</h2>" + statusWithTime;

        div.appendChild(jdiv);
    }

    if (hasOldJob) {
        div.className = "pipeline old";
    } else {
        div.className = "pipeline";
    }

    return div;
}
function relativeTime(then) {
    var now = new Date();
    var millis = now.getTime() - then.getTime();
    var secs = Math.floor(millis / 1000);
    var mins = Math.floor(secs / 60);
    var hours = Math.floor(mins / 60);
    var days = Math.floor(hours / 24);
    var weeks = Math.floor(days / 7);

    if (weeks > 1) {
        return pluralize(weeks, "week") + " ago";
    }
    if (days > 0) {
        return pluralize(days, "day") + " ago";
    }
    if (hours > 0) {
        return pluralize(hours, "hour", "an") + " ago";
    }
    if (mins > 0) {
        return pluralize(mins, "minute") + " ago";
    }
    return "less than a minute ago";
}
function pluralize(val, str, article) {
    if (article === undefined) {
        article = "a";
    }
    if (val == 1) {
        return article + " " + str;
    }
    return val + " " + str + "s";
}
function say(words, repeatKey, minIntervalSeconds) {
    if ('speechSynthesis' in window) {
        var now = Date.now();
        var lastTime = window.localStorage.getItem(repeatKey);
        if (lastTime === undefined || (now - lastTime) > (minIntervalSeconds * 1000)) {
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(words));
            window.localStorage.setItem(repeatKey, now);
        }
    } else {
        console.log("Couldn't say '" + words + "' because no speechSynthesis");
    }
}
