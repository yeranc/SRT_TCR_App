sap.ui.define([
    "sap/m/MessageToast",
    "sap/ui/export/Spreadsheet",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/BusyIndicator"
], function (MessageToast, Spreadsheet, JSONModel, BusyIndicator) {
    "use strict";

    return {
        /*
        /* Method get_results
        /* Fetch process logs for selected TCRs
        */
        get_results: function () {
            const aContexts = this.extensionAPI.getSelectedContexts();

            if (!aContexts || !aContexts.length) {
                MessageToast.show("No rows selected");
                return;
            }

            // Show busy indicator
            BusyIndicator.show(0);

            // Get unique TCR numbers from selected contexts
            const mUnique = {};
            aContexts.forEach(function (oContext) {
                const oObj = oContext.getObject();
                mUnique[oObj.vtgrrnr] = oObj;
            });

            const aUniqueContextObjects = Object.values(mUnique);

            // Collect unique TCR numbers
            const aSelectedTCRs = aUniqueContextObjects.map(function (oObj) {
                return String(oObj.vtgrrnr).padStart(20, "0");
            });

            // Collect unique non-empty ProcessingIds
            const aProcessingIds = [];
            aUniqueContextObjects.forEach(function (oObj) {
                const sPid = oObj.processingID;
                if (sPid && sPid.trim() !== "" && !aProcessingIds.includes(sPid)) {
                    aProcessingIds.push(sPid);
                }
            });

            // If all the selected rows have empty ProcessingId, we will show a message "not yet been replicated"
            if (!aProcessingIds.length) {
                const aFallback = [];
                aUniqueContextObjects.forEach(function (oObj) {
                    const sTcr = String(oObj.vtgrrnr).padStart(20, "0");
                    if (!aFallback.some(function (o) { return o.SourceNumber === sTcr; })) {
                        aFallback.push({
                            SourceNumber: sTcr,
                            ObjectType: "TCR",
                            Message: "TCR " + oObj.vtgrrnr + " has not yet been replicated"
                        });
                    }
                });
                BusyIndicator.hide();
                this._showResultDialog(aFallback);
                return;
            }

            // Build filter for ProcessingId
            const aPidFilters = aProcessingIds.map(function (sPid) {
                return new sap.ui.model.Filter("ProcessingId", sap.ui.model.FilterOperator.EQ, sPid);
            });
            const oFinalFilter = new sap.ui.model.Filter({ filters: aPidFilters, and: false });

            // Build filter for TCR number that will be useful for TCRMapping
            const aTCRFilters = aSelectedTCRs.map(function (sTCR) {
                return new sap.ui.model.Filter("Vtgrrnr", sap.ui.model.FilterOperator.EQ, sTCR);
            });
            const oTCRFilter = new sap.ui.model.Filter({ filters: aTCRFilters, and: false });

            const oModel = this.getView().getModel();
            oModel.read("/ProcessLog", {
                filters: [oFinalFilter],
                success: function (oData) {
                    const aResults = oData.results || [];

                    // Fetch the TCR data for the selected TCRs using TCRMapping entityset
                    oModel.read("/TCRMapping", {
                        filters: [oTCRFilter],
                        success: function (oTCRData) {
                            const aMappings = oTCRData.results || [];

                            // Build a map from ProcessingId -> TCR number for easy lookup
                            const mapPidToTcr = {};
                            aUniqueContextObjects.forEach(function (oObj) {
                                if (oObj.processingID && oObj.processingID.trim() !== "") {
                                    mapPidToTcr[String(oObj.processingID)] = String(oObj.vtgrrnr).padStart(20, "0");
                                }
                            });

                            // Filter logs based on ObjectType and mapping
                            const aFinalResults = aResults.filter(function (oLog) {
                                if (oLog.ObjectType === "TCR") {
                                    return aSelectedTCRs.includes(oLog.SourceNumber);
                                }
                                if (oLog.ObjectType === "TREATY") {
                                    return aMappings.some(function (oMap) {
                                        return oMap.Fldname === "VTGNR" && oMap.Low === oLog.SourceNumber;
                                    });
                                }
                                if (oLog.ObjectType === "BP") {
                                    return aMappings.some(function (oMap) {
                                        return ["GESNR", "VERANTW_GESNR", "ZE_GESNR"].includes(oMap.Fldname)
                                            && oMap.Low === oLog.SourceNumber;
                                    });
                                }
                                return false;
                            }).map(function (oLog) {
                                // Attach the parent TCR number to each log entry
                                return Object.assign({}, oLog, {
                                    TCRNumber: mapPidToTcr[String(oLog.ProcessingId)] || ""
                                });
                            });

                            // Add "not replicated" for TCRs with no ProcessingId
                            aUniqueContextObjects.forEach(function (oObj) {
                                const sPid = oObj.processingID;
                                if (!sPid || sPid.trim() === "") {
                                    const sTcr = String(oObj.vtgrrnr).padStart(20, "0");
                                    if (!aFinalResults.some(function (o) { return o.SourceNumber === sTcr; })) {
                                        aFinalResults.push({
                                            TCRNumber: String(oObj.vtgrrnr).padStart(20, "0"),
                                            ObjectType: "TCR",
                                            Message: "TCR " + oObj.vtgrrnr + " has not yet been replicated"
                                        });
                                    }
                                }
                            });

                            if (!aFinalResults.length) {
                                BusyIndicator.hide();
                                MessageToast.show("No log entries found");
                                return;
                            }

                            // Sort by TCR number
                            aFinalResults.sort(function (a, b) {
                                return Number(a.TCRNumber) - Number(b.TCRNumber);
                            });

                            BusyIndicator.hide();
                            this._showResultDialog(aFinalResults);

                        }.bind(this),
                        error: function () {
                            BusyIndicator.hide();
                            MessageToast.show("Error fetching TCR mapping");
                        }
                    });
                }.bind(this),
                error: function () {
                    BusyIndicator.hide();
                    MessageToast.show("Error fetching process logs");
                }
            });
        },

        /*
        /* Method _showResultDialog
        /* Display logs in a dialog table
        */
        _showResultDialog: function (aResults) {
            const oJsonModel = new JSONModel({ results: aResults });

            const oTable = new sap.m.Table({
                growing: true,
                growingThreshold: 50,
                columns: [
                    new sap.m.Column({ header: new sap.m.Text({ text: "TCR Number" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Object Type" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Source Object Number" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Process Ref ID" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Target Object Number" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Target System" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Message Type" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Message" }) })
                ]
            });

            // Bind result data to table
            oTable.setModel(oJsonModel);
            oTable.bindItems({
                path: "/results",
                template: new sap.m.ColumnListItem({
                    cells: [
                        new sap.m.Text({ text: "{TCRNumber}" }),
                        new sap.m.Text({ text: "{ObjectType}" }),
                        new sap.m.Text({ text: "{SourceNumber}" }),
                        new sap.m.Text({ text: "{ProcessingId}" }),
                        new sap.m.Text({ text: "{TargetNumber}" }),
                        new sap.m.Text({ text: "{Systemm}" }),
                        new sap.m.Text({ text: "{Type}" }),
                        new sap.m.Text({ text: "{Message}" })
                    ]
                })
            });

            // Export button
            const oExportButton = new sap.m.Button({
                text: "Export",
                type: "Emphasized",
                press: function () {
                    this._exportToExcel(aResults);
                }.bind(this)
            });

            // Results dialog
            const oDialog = new sap.m.Dialog({
                title: "TCR Copy Logs",
                contentWidth: "90%",
                contentHeight: "80%",
                resizable: true,
                draggable: true,
                content: [oTable],
                buttons: [
                    oExportButton,
                    new sap.m.Button({
                        text: "Close",
                        press: function () {
                            oDialog.close();
                        }
                    })
                ],
                afterClose: function () {
                    oDialog.destroy();
                }
            });

            oDialog.open();
        },

        _exportToExcel: function (aData) {
            if (!aData || !aData.length) {
                MessageToast.show("No records to export");
                return;
            }

            const aCols = [
                { label: "TCR Number", property: "TCRNumber" },
                { label: "Process Ref ID", property: "ProcessingId" },
                { label: "Object Type", property: "ObjectType" },
                { label: "Source Object Number", property: "SourceNumber" },
                { label: "Message Type", property: "Type" },
                { label: "Message", property: "Message" },
                { label: "Target Object Number", property: "TargetNumber" },
                { label: "System", property: "Systemm" }
            ];

            const oSheet = new Spreadsheet({
                workbook: { columns: aCols },
                dataSource: aData,
                fileName: "TCR_Copy_Log.xlsx"
            });

            oSheet.build()
                .then(function () {
                    MessageToast.show("Excel downloaded successfully");
                })
                .finally(function () {
                    oSheet.destroy();
                });
        }
    };
});