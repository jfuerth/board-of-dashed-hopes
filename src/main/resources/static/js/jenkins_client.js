function JenkinsClient(base_url) {
    var self = this;

    /**
     * Client-supplied callback. Called when there is a likely authentication failure.
     *
     * @param reason an HTML string describing the auth failure.
     */
    this.onAuthError = null;

    this.basicCredentials = null;

    function xhrGet(url, onSuccess) {
        xhrGetWithHeaders(url, {"Authorization": self.basicCredentials}, onSuccess);
    }

    function xhrGetWithHeaders(url, headers, onSuccess) {
        var xhr = new XMLHttpRequest();

        xhr.addEventListener("load", function(evt) {
            if (this.status === 403) {
                self.onAuthError("Authorization Error")
            }
            var responseJson = JSON.parse(this.responseText);
            onSuccess(responseJson);
        });
        xhr.addEventListener("error", function(evt) { console.log("Error in XHR", evt) });
        xhr.addEventListener("abort", function(evt) { console.log("XHR aborted", evt) });

        if (url.startsWith("/")) {
            url = base_url + url;
        }

        xhr.open("GET", url);

        for (var header in headers) {
            if (headers.hasOwnProperty(header)) {
                xhr.setRequestHeader(header, headers[header]);
            }
        }

        xhr.send();
    }

    function groupBy(xs, groupName) {
        return xs.reduce(function(rv, x) {
            var group = groupName(x);
            (rv[group] = rv[group] || []).push(x);
            return rv;
        }, {});
    }

    function parseJobFullName(fullName) {
        var parts = fullName.match(/^(.*)?\/?generated-(.*)-(staging|prod[-a-z]*|app|journey)-(image-build|deployment|journey-test)$/);
        if (parts == null) {
            console.log("Job name doesn't match regex:", fullName);
            return {
                name: fullName
            }
        }
        return {
            folder: parts[1],
            name: parts[2],
            environment: parts[3],
            stage: parts[4]
        }
    }

    this.auth = function(username, password, onSuccess) {
        self.basicCredentials = "Basic " + btoa(username + ":" + password);
        xhrGet("/api", function(responseJson) {
            if (onSuccess !== undefined) {
                onSuccess(responseJson);
            }
        });
    };

    this.getPipelines = function(onSuccess) {
        xhrGet("/view/All%20CD%20Pipelines/api/json?depth=1&tree=jobs[fullName,url,downstreamProjects[fullName],lastBuild[url,number,duration,timestamp,result,changeSet[items[msg,author[fullName]]]]]", function(viewResponse) {
            var jobsResponse = viewResponse.jobs;
            if (jobsResponse.length === 0) {
                self.onAuthError("No jobs found.")
                return;
            }

            var jobsByPipeline = groupBy(
                jobsResponse,
                function(job) {
                    var nameParts = parseJobFullName(job.fullName);
                    return nameParts.folder + nameParts.name;
                });

            var result = [];
            for (var pipeline in jobsByPipeline) {
                if (!jobsByPipeline.hasOwnProperty(pipeline)) {
                    continue;
                }

                // these variables track the latest time a component job within the pipeline reported each status
                var newestFailureTime = 0;
                var newestRunningTime = 0;
                var newestSuccessTime = 0;
                var newestSuccessJobTimes = {};

                var jobs = jobsByPipeline[pipeline];
                console.log("Examining", jobs.length, "jobs in", pipeline, jobs);
                for (var i = 0; i < jobs.length; i++) {
                    var job = jobs[i];

                    var finishedBuild = job["lastBuild"];
                    if (finishedBuild != null) {
                        if (finishedBuild.result === "FAILURE") {
                            newestFailureTime = Math.max(newestFailureTime, finishedBuild["timestamp"]);
                        } else if (finishedBuild.status === "SUCCESS") {
                            newestSuccessTime = Math.max(newestSuccessTime, finishedBuild["timestamp"]);
                            newestSuccessJobTimes[job["fullName"]] = finishedBuild["timestamp"];
                        }
                    }

                    var nextBuild = job["next_build"];
                    if (nextBuild != null) {
                        newestRunningTime = Math.max(newestRunningTime, nextBuild["start_time"]);
                    }
                }

                result.push({
                    "name": pipeline,
                    "jobs": orderedJobs(jobs).map(jenkinsJobToUiJob),
                    "newestFailureTime": newestFailureTime,
                    "newestRunningTime": newestRunningTime,
                    "newestSuccessTime": newestSuccessTime,
                    "newestSuccessJobTimes": newestSuccessJobTimes
                });
            }
            console.log("Sending pipeline statuses to UI", result);
            onSuccess(result);
        });
    };

    function orderedJobs(jobs) {
        var L = [];
        var white = jobs.map(function(j) { return j }); // TODO sort unattached nodes to the end of this list
        var grey = [];
        var black = [];

        function visit(n) {
            var jobName = n["fullName"];

            if (black.indexOf(jobName) !== -1) {
                return;
            }
            if (grey.indexOf(jobName) !== -1) {
                console.log("Error: found cyclic dependency in pipeline. Order will be wonky near", jobName);
                return;
            }

            // move n from white to grey
            white = white.filter(function(name) { return name !== jobName } );
            grey.push(jobName);

            // visit each node m with an edge from n to m
            var downstreamJobNames = n["downstreamProjects"].map(function(p) { return p["fullName"]; });
            jobs.filter(function(m) { return downstreamJobNames.indexOf(m["fullName"]) !== -1; })
                .forEach(function(m) { visit(m); });

            // move n from grey to black
            grey = grey.filter(function(name) { return name !== n["fullName"]} );
            black.push(jobName);

            L.unshift(n);
        }

        while (white.length > 0) {
            var n = white.shift();
            visit(n);
        }

        return L;
    }

    function jenkinsJobToUiJob(jj) {
        var nameParts = parseJobFullName(jj["fullName"]);
        return {
            name: nameParts.environment + " " + nameParts.stage,
            finished_build: jenkinsBuildToUiBuild(jj["lastBuild"])
            // TODO: if job is running now, finished_build should be the latest completed build
            // and next_build should be the running one
            // uiJob["next_build"] = jenkinsBuildToUiBuild(jj["???"]);
        }
    }

    function jenkinsBuildToUiBuild(jenkinsBuild) {
        if (jenkinsBuild == null) {
            return undefined;
        }
        return {
            start_time: jenkinsBuild.timestamp / 1000,
            end_time: (jenkinsBuild.timestamp + jenkinsBuild.duration) / 1000,
            status: jenkinsBuildResultToUiStatus(jenkinsBuild.result)
        }
    }

    function jenkinsBuildResultToUiStatus(jenkinsStatus) {
        if (jenkinsStatus === null) {
            return 'started';
        } else if (jenkinsStatus === 'SUCCESS') {
            return 'succeeded';
        } else if (jenkinsStatus === 'FAILURE') {
            return 'failed';
        } else {
            console.log("Unknown Jenkins job status", jenkinsStatus);
            return 'unknown';
        }
    }
}
